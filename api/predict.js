/**
 * Vercel Serverless Function: Roboflow Cloud API Proxy
 * Roboflow Workflow 및 Hosted Classifier 422 validation 에러 해결 적용
 */

export default async function handler(req, res) {
  // CORS 및 기본 JSON 반환 헤더 세팅
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 가능합니다.' });
  }

  try {
    const { image } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: '이미지 데이터(Base64)가 전송되지 않았습니다.' });
    }

    const apiKey = (process.env.ROBOFLOW_API_KEY || '').trim();
    let endpoint = (process.env.ROBOFLOW_ENDPOINT || '').trim();

    if (!apiKey) {
      return res.status(500).json({ error: 'Vercel 환경변수 ROBOFLOW_API_KEY 설정이 안 되어 있습니다.' });
    }

    if (!endpoint) {
      return res.status(500).json({ error: 'Vercel 환경변수 ROBOFLOW_ENDPOINT 설정이 안 되어 있습니다.' });
    }

    // 순수 Base64 디코딩 (data:image/... 제거)
    const cleanBase64 = image.replace(/^data:image\/\w+;base64,/, '');

    let targetUrl;
    try {
      targetUrl = new URL(endpoint);
    } catch (e) {
      return res.status(500).json({ error: `잘못된 ROBOFLOW_ENDPOINT URL 형식입니다: ${endpoint}` });
    }

    targetUrl.searchParams.set('api_key', apiKey);

    // Roboflow Workflow / Standard API 호환 3단계 요청 (422 방지 로직)
    let roboflowResponse = null;
    let rawData = null;
    let lastErrText = "";

    // 1단계: Workflow 표준 규격 전송
    const payloadWorkflow = {
      inputs: {
        image: {
          type: "base64",
          value: cleanBase64
        }
      }
    };

    roboflowResponse = await fetch(targetUrl.toString(), {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payloadWorkflow)
    });

    if (roboflowResponse.ok) {
      rawData = await roboflowResponse.json();
    } else {
      lastErrText = await roboflowResponse.text();

      // 2단계: 422 발생 시 Standard Classification Object 규격 시도
      const payloadStandard = {
        image: {
          type: "base64",
          value: cleanBase64
        }
      };

      roboflowResponse = await fetch(targetUrl.toString(), {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payloadStandard)
      });

      if (roboflowResponse.ok) {
        rawData = await roboflowResponse.json();
      } else {
        // 3단계: 일반 Base64 Raw String 시도 (Hosted Classifier 백업)
        roboflowResponse = await fetch(targetUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: cleanBase64
        });

        if (roboflowResponse.ok) {
          rawData = await roboflowResponse.json();
        } else {
          const finalErr = await roboflowResponse.text();
          console.error(`Roboflow API Final Fail (${roboflowResponse.status}):`, finalErr);
          return res.status(roboflowResponse.status).json({
            error: `Roboflow API 호출 실패 (${roboflowResponse.status}): ${finalErr.substring(0, 150)}`
          });
        }
      }
    }

    // 결과 파싱
    let predictedClass = 'unknown';
    let confidence = 0;

    if (rawData) {
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
    }

    return res.status(200).json({
      success: true,
      class: predictedClass,
      confidence: confidence,
      raw: rawData
    });

  } catch (error) {
    console.error('Serverless Function Catch Error:', error);
    return res.status(500).json({ error: `서버 내부 오류: ${error.message}` });
  }
}