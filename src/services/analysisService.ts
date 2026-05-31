import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function withRetry<T>(
  fn: () => Promise<T>, 
  maxRetries = 10, 
  initialDelay = 5000,
  onRetry?: (attempt: number, delay: number, isRateLimit: boolean) => void,
  signal?: AbortSignal
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    
    try {
      return await fn();
    } catch (err: any) {
      if (signal?.aborted) throw new Error('Aborted');
      lastError = err;
      const status = err?.status || err?.error?.status || (err?.message?.includes('RESOURCE_EXHAUSTED') ? 'RESOURCE_EXHAUSTED' : null);
      const code = err?.code || err?.error?.code || (err?.message?.includes('429') ? 429 : null);
      
      if (status === 'INTERNAL' || status === 'RESOURCE_EXHAUSTED' || code === 500 || code === 429) {
        const isRateLimit = status === 'RESOURCE_EXHAUSTED' || code === 429;
        const baseDelay = isRateLimit ? 15000 : initialDelay;
        const delay = (baseDelay * Math.pow(2, i)) + (Math.random() * 5000); 
        
        if (onRetry) onRetry(i + 1, delay, isRateLimit);
        
        const minutes = Math.floor(delay / 60000);
        const seconds = Math.floor((delay % 60000) / 1000);
        const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        
        console.warn(`Gemini API ${isRateLimit ? 'Rate Limit' : 'Error'}. Retrying in ${timeStr}... (Attempt ${i + 1}/${maxRetries})`);
        
        // Wait with abort support
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, delay);
          signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Aborted'));
          }, { once: true });
        });
        
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export interface SICCode {
  code: string;
  description: string;
}

export interface AnalysisResult {
  caseName: string;
  caseReference: string;
  jurisdiction: string;
  matches: {
    sicCode: string;
    description: string;
    industryContext: string;
    confidence: number;
    reasoning: string;
  }[];
  summary: string;
  moneyLaunderingStatus: 'Confirmed' | 'Alleged' | 'Discussed/Precedent' | 'None';
  moneyLaunderingReasoning: string;
  moneyLaunderingConfidence: number;
  additionalInsights: string[];
}

export async function analyzeCourtCase(
  caseText: string,
  sicCodes: SICCode[],
  fileData?: { data: string; mimeType: string; fileName?: string },
  onStream?: (chunk: string) => void,
  onRetry?: (msg: string) => void,
  signal?: AbortSignal
): Promise<AnalysisResult> {
  const model = "gemini-3.1-pro-preview"; 

  const systemInstruction = `
    You are an expert legal and compliance analyst specializing in UK and International court cases. 
    Your task is to analyze court documents with extreme precision, focusing on business activities (SIC codes) and money laundering involvement.
    
    CRITICAL RULES:
    1. **Money Laundering Status**: 
       - 'Confirmed': Explicit conviction or sentencing remarks confirming the defendant's active role.
       - 'Alleged': Current charges or ongoing prosecution without a final verdict in this document.
       - 'Discussed/Precedent': Legal theory, citations of other cases, or hypothetical scenarios only.
       - 'None': No mention.
    2. **SIC Matching**: Match the defendant's actual business activities described in the case to the provided SIC codes.
    3. **Precision**: Distinguish clearly between the actions of the defendant and the actions of third parties or legal precedents mentioned in the text.
    4. **Confidence Scores**: All confidence scores (for ML and SIC matches) MUST be integers between 0 and 100. Never use decimals or probabilities between 0 and 1.
    5. **Output**: Always return valid JSON matching the requested schema.
  `;

  const prompt = `
    Analyze the following court case:
    
    1. **Case Identification**: Extract Name, Reference/Citation, and Jurisdiction.
    ${fileData?.fileName ? `Note: The filename is "${fileData.fileName}".` : ""}
    
    2. **SIC Code Matching**: Identify matches from the provided list based on the defendant's business context.
    
    3. **Money Laundering Analysis**: Determine status (Confirmed, Alleged, Discussed/Precedent, None) with detailed reasoning and confidence.
    
    4. **Summary & Insights**: Provide a comprehensive summary and any additional legal/financial insights.
    
    Provided SIC Codes:
    ${sicCodes.map(s => `${s.code}: ${s.description}`).join("\n")}
    
    ${fileData ? "Please analyze the attached document." : `Court Case Text:\n${caseText.substring(0, 30000)}`}
  `;

  const parts: any[] = [{ text: prompt }];
  if (fileData) {
    parts.push({
      inlineData: {
        data: fileData.data,
        mimeType: fileData.mimeType
      }
    });
  }

  const responseStream = await withRetry(() => ai.models.generateContentStream({
    model,
    contents: [{ parts }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          caseName: { type: Type.STRING },
          caseReference: { type: Type.STRING },
          jurisdiction: { type: Type.STRING },
          summary: { type: Type.STRING },
          moneyLaunderingStatus: { 
            type: Type.STRING,
            enum: ['Confirmed', 'Alleged', 'Discussed/Precedent', 'None']
          },
          moneyLaunderingReasoning: { type: Type.STRING },
          moneyLaunderingConfidence: { 
            type: Type.NUMBER,
            description: "Confidence score from 0 to 100 representing how certain the model is about the ML status."
          },
          additionalInsights: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of helpful legal or financial insights identified in the case."
          },
          matches: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sicCode: { type: Type.STRING },
                description: { type: Type.STRING },
                industryContext: { 
                  type: Type.STRING, 
                  description: "A brief general explanation of what this SIC category represents and the types of businesses it typically covers."
                },
                confidence: { 
                  type: Type.NUMBER,
                  description: "Confidence score from 0 to 100 representing how well the case matches this SIC code."
                },
                reasoning: { type: Type.STRING },
              },
              required: ["sicCode", "description", "industryContext", "confidence", "reasoning"],
            },
          },
        },
        required: ["caseName", "caseReference", "jurisdiction", "summary", "matches", "moneyLaunderingStatus", "moneyLaunderingReasoning", "moneyLaunderingConfidence", "additionalInsights"],
      },
    },
  }), 10, 5000, (attempt, delay, isRateLimit) => {
    if (onRetry) {
      const minutes = Math.floor(delay / 60000);
      const seconds = Math.floor((delay % 60000) / 1000);
      const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      onRetry(`${isRateLimit ? 'Rate Limit' : 'API Error'}: Retrying in ${timeStr} (Attempt ${attempt}/10)`);
    }
  }, signal);

  let fullText = "";
  for await (const chunk of responseStream) {
    if (signal?.aborted) throw new Error('Aborted');
    const text = chunk.text || "";
    fullText += text;
    if (onStream) onStream(text);
  }

  try {
    return JSON.parse(fullText || "{}");
  } catch (e) {
    if (signal?.aborted) throw new Error('Aborted');
    console.error("Failed to parse AI response", e, fullText);
    throw new Error("Analysis failed to produce valid data.");
  }
}
