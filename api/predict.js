// Vercel Serverless Function (Node.js runtime)
// Roboflow Cloud Workflow / Inference API 프록시

export default async function handler(req, res) {
  // POST 메서드만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  }

  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: '이미지 데이터가 전달되지 않았습니다.' });
    }

    const apiKey = process.env.ROBOFLOW_API_KEY;
    const endpointUrl = process.env.ROBOFLOW_ENDPOINT;

    if (!apiKey || !endpointUrl) {
      return res.status(500).json({ 
        error: '서버 환경변수(ROBOFLOW_API_KEY 또는 ROBOFLOW_ENDPOINT)가 설정되지 않았습니다.' 
      });
    }

    // Base64 Prefix 제거 (data:image/jpeg;base64,... 형식일 경우)
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    // Roboflow API 호출 (URL Query Parameter에 API Key 연결)
    const requestUrl = endpointUrl.includes('?') 
      ? `${endpointUrl}&api_key=${apiKey}` 
      : `${endpointUrl}?api_key=${apiKey}`;

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: base64Data
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Roboflow API error:', errorText);
      return res.status(response.status).json({ 
        error: `Roboflow API 오류: ${response.statusText}` 
      });
    }

    const result = await response.json();

    // Workflow / Classification 모델 파싱 (응답 구조에 맞춰 유연하게 처리)
    let predictedClass = null;
    let confidence = 0;

    // 1. Workflow 형식 응답 처리
    if (result.outputs && Array.isArray(result.outputs) && result.outputs.length > 0) {
      const outputObj = result.outputs[0];
      const predictions = outputObj.predictions || outputObj.response?.predictions;
      
      if (predictions) {
        if (predictions.top) {
          predictedClass = predictions.top;
          confidence = predictions.confidence || 0;
        } else if (Array.isArray(predictions) && predictions.length > 0) {
          predictedClass = predictions[0].class || predictions[0].label;
          confidence = predictions[0].confidence || 0;
        }
      }
    } 
    // 2. 단일 Classification 모델 표준 응답 처리
    else if (result.predictions) {
      if (typeof result.predictions === 'object' && result.top) {
        predictedClass = result.top;
        confidence = result.confidence || 0;
      } else if (Array.isArray(result.predictions) && result.predictions.length > 0) {
        predictedClass = result.predictions[0].class || result.predictions[0].label;
        confidence = result.predictions[0].confidence || 0;
      }
    } 
    // 3. 바로 top/confidence가 있는 경우
    else if (result.top) {
      predictedClass = result.top;
      confidence = result.confidence || 0;
    }

    return res.status(200).json({
      class: predictedClass,
      confidence: confidence,
      raw: result // 디버깅용
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: `서버 내부 오류: ${err.message}` });
  }
}