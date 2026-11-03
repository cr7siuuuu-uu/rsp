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
    let endpointUrl = process.env.ROBOFLOW_ENDPOINT;

    if (!apiKey || !endpointUrl) {
    // URL 앞뒤 공백 제거 및 API Key 준비
    endpointUrl = endpointUrl.trim();
    const cleanApiKey = apiKey.trim();

    // Base64 Data URL에서 데이터 부분만 추출 (data:image/jpeg;base64,... -> raw base64)
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    // Roboflow Workflow인지 일반 Classification/Detection API인지 구별
    const isWorkflow = endpointUrl.includes('workflows') || endpointUrl.includes('workflow');

    let response;
    
    // URL 생성 (쿼리스트링에도 api_key 포함)
    const urlObj = new URL(endpointUrl);
    urlObj.searchParams.set('api_key', cleanApiKey);

    if (isWorkflow) {
      // Roboflow Cloud Workflow API 호출 규격 (인증 헤더 추가)
      response = await fetch(urlObj.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanApiKey}`,
          'X-Api-Key': cleanApiKey
        },
        body: JSON.stringify({
          inputs: {
            image: {
              type: 'base64',
              value: base64Data
            }
          }
        })
      });
    } else {
      // Roboflow Standard Deployments / Inference API
      response = await fetch(urlObj.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${cleanApiKey}`,
          'X-Api-Key': cleanApiKey
        },
        body: base64Data
      });
    }

    // 오류 발생 시 Roboflow의 실제 응답 본문을 포함하여 응답
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Roboflow API error response:', errorText);
      return res.status(response.status).json({ 
        error: `Roboflow API 오류 (${response.status}): ${errorText || response.statusText}` 
      });
    }

    const result = await response.json();

    // 응답 데이터에서 클래스 및 신뢰도(Confidence) 파싱
    let predictedClass = null;
    let confidence = 0;

    // 1. Workflow 형식 응답 파싱
    if (result.outputs && Array.isArray(result.outputs) && result.outputs.length > 0) {
      const outputObj = result.outputs[0];
      // Workflow의 노드 output 이름에 따른 유연한 접근
      const predictions = outputObj.predictions || outputObj.predictions?.predictions || outputObj.response?.predictions || outputObj;
      
      if (predictions) {
        if (predictions.top) {
          predictedClass = predictions.top;
          confidence = predictions.confidence || 0;
        } else if (Array.isArray(predictions) && predictions.length > 0) {
          predictedClass = predictions[0].class || predictions[0].label;
          confidence = predictions[0].confidence || 0;
        } else if (typeof predictions === 'object') {
          // 분류 결과 dictionary 형태 (예: { rock: 0.9, paper: 0.1 })
          let maxConf = 0;
          for (const [cls, conf] of Object.entries(predictions)) {
            if (typeof conf === 'number' && conf > maxConf) {
              maxConf = conf;
              predictedClass = cls;
              confidence = conf;
            }
          }
        }
      }
    } 
    // 2. Standard Inference API 응답 파싱
    else if (result.predictions) {
      if (typeof result.predictions === 'object' && !Array.isArray(result.predictions)) {
        predictedClass = result.top || Object.keys(result.predictions)[0];
        confidence = result.confidence || result.predictions[predictedClass] || 0;
      } else if (Array.isArray(result.predictions) && result.predictions.length > 0) {
        predictedClass = result.predictions[0].class || result.predictions[0].label;
        confidence = result.predictions[0].confidence || 0;
      }
    } 
    // 3. 단일 top / confidence 객체
    else if (result.top) {
      predictedClass = result.top;
      confidence = result.confidence || 0;
    }

    return res.status(200).json({
      class: predictedClass,
      confidence: confidence,
      raw: result
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: `서버 내부 오류: ${err.message}` });
  }
}