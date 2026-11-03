/**
 * Vercel Serverless Function: Roboflow Cloud API Proxy
 */

export default async function handler(req, res) {
  // CORS 및 JSON 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. POST 요청만 지원합니다.' });
  }

  try {
    const { image } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: '요청 데이터에 image (Base64)가 누락되었습니다.' });
    }

    // 환경변수 양옆 공백 및 줄바꿈 제거 (Key 복사 오타 방지)
    const apiKey = (process.env.ROBOFLOW_API_KEY || '').trim();
    let endpoint = (process.env.ROBOFLOW_ENDPOINT || '').trim();

    if (!apiKey) {
      return res.status(500).json({ 
        error: 'ROBOFLOW_API_KEY 환경변수가 설정되지 않았습니다. Vercel Settings -> Environment Variables를 확인해 주세요.' 
      });
    }

    if (!endpoint) {
      return res.status(500).json({ 
        error: 'ROBOFLOW_ENDPOINT 환경변수가 설정되지 않았습니다. Vercel Settings -> Environment Variables를 확인해 주세요.' 
      });
    }

    // Base64 Prefix 제거 (pure base64)
    const cleanBase64 = image.replace(/^data:image\/\w+;base64,/, '');

    // URL 객체 생성 및 api_key 세팅
    let targetUrl;
    try {
      targetUrl = new URL(endpoint);
    } catch (e) {
      return res.status(500).json({ error: `잘못된 ROBOFLOW_ENDPOINT URL 형식입니다: ${endpoint}` });
    }
    targetUrl.searchParams.set('api_key', apiKey);

    // Roboflow Workflow / Classification 호환 요청 생성
    const isWorkflow = endpoint.includes('/workflows/');
    let bodyData;
    let contentType = 'application/json';

    if (isWorkflow) {
      // Roboflow Workflow 규격: {"inputs": {"image": {"type": "base64", "value": "..."}}}
      bodyData = JSON.stringify({
        inputs: {
          image: {
            type: "base64",
            value: cleanBase64
          }
        }
      });
    } else {
      // Standard Hosted Classification / Detection API 규격
      bodyData = JSON.stringify({
        image: {
          type: "base64",
          value: cleanBase64
        }
      });
    }

    let roboflowResponse = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: bodyData
    });

    // 만약 Workflow가 아닌 일반 모델인데 422가 뜬 경우 direct string fallback
    if (!roboflowResponse.ok && roboflowResponse.status === 422 && !isWorkflow) {
      roboflowResponse = await fetch(targetUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: cleanBase64
      });
    }

    if (!roboflowResponse.ok) {
      const errText = await roboflowResponse.text();
      console.error(`Roboflow API Error (${roboflowResponse.status}):`, errText);
      return res.status(roboflowResponse.status).json({ 
        error: `Roboflow API 호출 실패 (${roboflowResponse.status}): Roboflow URL 주소나 API Key를 확인해 주세요. (${errText.substring(0, 100)})` 
      });
    }

    const rawData = await roboflowResponse.json();

    let predictedClass = 'unknown';
    let confidence = 0;

    // Roboflow 다양한 응답 구조 통합 추출
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