/**
 * Vercel Serverless Function: Roboflow Cloud API Proxy
 */

export default async function handler(req, res) {
  // 항상 JSON 헤더 명시
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. POST 요청만 지원합니다.' });
  }

  try {
    const { image } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: '요청 바디에 image (Base64) 데이터가 누락되었습니다.' });
    }

    // 환경변수 추출 및 양옆 공백/줄바꿈 완전히 제거
    const apiKey = (process.env.ROBOFLOW_API_KEY || '').trim();
    let endpoint = (process.env.ROBOFLOW_ENDPOINT || '').trim();

    if (!apiKey || !endpoint) {
      return res.status(500).json({ 
        error: 'Vercel 환경변수(ROBOFLOW_API_KEY 또는 ROBOFLOW_ENDPOINT)가 등록되지 않았습니다. Vercel Settings -> Environment Variables를 확인해 주세요.' 
      });
    }

    // Base64 데이터 정제
    const cleanBase64 = image.replace(/^data:image\/\w+;base64,/, '');

    // URL 및 API Key 파라미터 정제
    const urlObj = new URL(endpoint);
    urlObj.searchParams.set('api_key', apiKey);

    // Roboflow Workflow / direct inference 지원 payload
    const payload = {
      inputs: {
        image: {
          type: "base64",
          value: cleanBase64
        }
      },
      image: {
        type: "base64",
        value: cleanBase64
      }
    };

    let roboflowResponse = await fetch(urlObj.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // 400/422/404 발생시 단일 Base64 전송 규격으로 폴백
    if (!roboflowResponse.ok && (roboflowResponse.status === 400 || roboflowResponse.status === 422 || roboflowResponse.status === 404)) {
      roboflowResponse = await fetch(urlObj.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: cleanBase64
      });
    }

    if (!roboflowResponse.ok) {
      const errText = await roboflowResponse.text();
      console.error('Roboflow API Error:', errText);
      return res.status(roboflowResponse.status).json({ 
        error: `Roboflow API 호출 실패 (${roboflowResponse.status}): Roboflow URL 및 API Key를 다시 확인해 주세요.` 
      });
    }

    const rawData = await roboflowResponse.json();

    let predictedClass = 'unknown';
    let confidence = 0;

    // Workflow 및 일반 Model response 구조 유연 파싱
    if (rawData.outputs && Array.isArray(rawData.outputs) && rawData.outputs.length > 0) {
      const output = rawData.outputs[0];
      const targetObj = output.predictions || output;

      if (targetObj.top) {
        predictedClass = targetObj.top;
        confidence = targetObj.confidence || targetObj.confidence_score || 0;
      } else if (Array.isArray(targetObj) && targetObj.length > 0) {
        predictedClass = targetObj[0].class || targetObj[0].label || targetObj[0].name;
        confidence = targetObj[0].confidence;
      } else if (typeof targetObj === 'object') {
        const keys = Object.keys(targetObj);
        if (keys.length > 0) {
          const topKey = keys.reduce((a, b) => (targetObj[a] > targetObj[b] ? a : b));
          if (typeof targetObj[topKey] === 'number') {
            predictedClass = topKey;
            confidence = targetObj[topKey];
          }
        }
      }
    } else if (rawData.top) {
      predictedClass = rawData.top;
      confidence = rawData.confidence || 0;
    } else if (rawData.predictions) {
      if (typeof rawData.predictions === 'object' && rawData.predictions.top) {
        predictedClass = rawData.predictions.top;
        confidence = rawData.predictions.confidence || 0;
      } else if (Array.isArray(rawData.predictions) && rawData.predictions.length > 0) {
        predictedClass = rawData.predictions[0].class || rawData.predictions[0].label;
        confidence = rawData.predictions[0].confidence;
      } else if (typeof rawData.predictions === 'object') {
        const keys = Object.keys(rawData.predictions);
        if (keys.length > 0) {
          const topKey = keys.reduce((a, b) => (rawData.predictions[a] > rawData.predictions[b] ? a : b));
          if (typeof rawData.predictions[topKey] === 'number') {
            predictedClass = topKey;
            confidence = rawData.predictions[topKey];
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      class: predictedClass,
      confidence: confidence,
      raw: rawData
    });

  } catch (error) {
    console.error('Serverless Error:', error);
    return res.status(500).json({ error: `서버 내부 오류: ${error.message}` });
  }
}