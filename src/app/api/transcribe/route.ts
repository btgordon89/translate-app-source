import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
const { Translate } = require('@google-cloud/translate').v2;

// Initialize OpenAI client lazily to avoid build-time issues
let openai: OpenAI | null = null;
let googleTranslate: any = null;

function getOpenAIClient() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

function getGoogleTranslateClient() {
  if (!googleTranslate) {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_TRANSLATE_API_KEY environment variable is required');
    }
    googleTranslate = new Translate({ key: apiKey });
  }
  return googleTranslate;
}

async function translateWithGoogle(text: string, language: string, requestId: string): Promise<string> {
  console.log(`🌐 [${requestId}] Starting Google Translate...`);
  
  try {
    const translate = getGoogleTranslateClient();
    console.log(`🔧 [${requestId}] Google Translate client initialized`);
    
    // Determine target language
    const targetLanguage = language === 'en' ? 'es' : 'en';
    
    console.log(`🔄 [${requestId}] Google Translate: ${language} → ${targetLanguage}, text: "${text.substring(0, 50)}..."`);
    
    const [translation] = await translate.translate(text, {
      from: language,
      to: targetLanguage
    });
    
    console.log(`✅ [${requestId}] Google Translate completed: "${translation.substring(0, 50)}..."`);
    return translation;
    
  } catch (error) {
    console.error(`❌ [${requestId}] Google Translate error:`, error);
    throw error;
  }
}

async function translateWithGPT4(text: string, language: string, requestId: string): Promise<string> {
  const client = getOpenAIClient();
  
  // Determine translation direction
  const sourceLanguage = language === 'en' ? 'English' : 'Mexican Spanish';
  const targetLanguage = language === 'en' ? 'Mexican Spanish' : 'English';
  
  console.log(`🔄 [${requestId}] GPT-4 Translate: ${sourceLanguage} → ${targetLanguage}`);
  
  // Use GPT-4 for high-quality translation
  const translationPrompt = language === 'en' 
    ? `Translate the following English text to Mexican Spanish (not Spain Spanish). Keep the tone and style natural and conversational as if spoken between a couple. Only return the translation, no explanations:\n\n"${text}"`
    : `Translate the following Mexican Spanish text to English. Keep the tone and style natural and conversational as if spoken between a couple. Only return the translation, no explanations:\n\n"${text}"`;

  const translationResponse = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: 'You are a professional translator specializing in conversational language between couples. Provide natural, accurate translations that preserve the emotional tone and informal style of speech.'
      },
      {
        role: 'user',
        content: translationPrompt
      }
    ],
    max_tokens: 200,
    temperature: 0.3 // Lower temperature for more consistent translations
  });

  return translationResponse.choices[0]?.message?.content?.trim() || '';
}

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  
  // Check URL parameters for optimization options
  const url = new URL(request.url);
  const translatorParam = url.searchParams.get('translator');
  const translationService = translatorParam || 'google'; // Default to Google (37x faster than GPT-4)
  
  // Whisper optimization parameters - optimized for speed by default
  const whisperModel = url.searchParams.get('model') || 'whisper-1';
  const languageHint = url.searchParams.get('language') || 'en'; // Default to English for speed
  const responseFormat = url.searchParams.get('format') === 'verbose_json' ? 'verbose_json' : 'text'; // Default to fast text format
  const temperatureParam = url.searchParams.get('temperature') || '0'; // Default to 0 for speed
  const optimize = url.searchParams.get('optimize') !== 'false'; // Default to optimized unless explicitly disabled
  
  console.log('🔥 === TRANSCRIPTION API CALLED ===', {
    requestId,
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get('user-agent'),
    contentType: request.headers.get('content-type'),
    url: request.url,
    translatorParam: translatorParam,
    translationService: translationService,
    whisperOptimizations: {
      model: whisperModel,
      language: languageHint,
      format: responseFormat,
      temperature: temperatureParam,
      optimize: optimize
    }
  });
  
  try {
    console.log(`📥 [${requestId}] Parsing form data...`);
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    console.log(`📄 [${requestId}] Audio file info:`, {
      exists: !!audioFile,
      name: audioFile?.name,
      size: audioFile?.size,
      type: audioFile?.type,
      sizeMB: audioFile?.size ? (audioFile.size / 1024 / 1024).toFixed(2) : 'unknown'
    });

    if (!audioFile) {
      console.error(`❌ [${requestId}] No audio file provided`);
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (audioFile.size === 0) {
      console.error(`❌ [${requestId}] Audio file is empty`);
      return NextResponse.json({ error: 'Audio file is empty' }, { status: 400 });
    }

    console.log(`🔧 [${requestId}] Converting audio file...`);
    // Convert the audio file to the format expected by OpenAI using toFile helper
    const arrayBuffer = await audioFile.arrayBuffer();
    console.log(`📦 [${requestId}] Audio buffer size:`, arrayBuffer.byteLength, 'bytes');

    console.log(`🤖 [${requestId}] Calling OpenAI Whisper API...`);
    console.log(`🔑 [${requestId}] API Key present:`, !!process.env.OPENAI_API_KEY);
    console.log(`🔑 [${requestId}] API Key preview:`, process.env.OPENAI_API_KEY?.substring(0, 10) + '...');

    // Use OpenAI toFile helper for proper file handling
    // Detect format from the file type and use appropriate format
    const fileType = audioFile.type || 'audio/webm';
    const fileName = fileType.includes('mp3') ? 'audio.mp3' : 'audio.webm';
    const audioFile2 = await toFile(arrayBuffer, fileName, { type: fileType });
    console.log(`📄 [${requestId}] File object created successfully`);

    // Use OpenAI Whisper API for transcription
    const client = getOpenAIClient();
    const whisperStartTime = Date.now();
    
    console.log(`🎵 [${requestId}] Starting Whisper transcription...`);
    console.log(`🔧 [${requestId}] Whisper config: model=${whisperModel}, language=${languageHint || 'auto-detect'}, format=${responseFormat}`);
    
    // Build optimized configuration
    const whisperConfig: any = {
      file: audioFile2,
      model: whisperModel,
      response_format: responseFormat,
    };
    
    // Add language hint if provided or if optimize=true
    if (languageHint || optimize) {
      whisperConfig.language = languageHint || 'en'; // Default to English for optimization
    }
    
    // Add temperature if specified
    if (temperatureParam) {
      whisperConfig.temperature = parseFloat(temperatureParam);
    } else if (optimize) {
      whisperConfig.temperature = 0; // Use 0 for fastest, most deterministic results
    }
    
    const transcription = await client.audio.transcriptions.create(whisperConfig);

    const whisperEndTime = Date.now();
    const whisperLatency = whisperEndTime - whisperStartTime;

    // Handle different response formats
    const transcribedText = typeof transcription === 'string' ? transcription : transcription.text;
    const detectedLanguage = typeof transcription === 'string' ? undefined : (transcription as any).language;
    const duration = typeof transcription === 'string' ? undefined : (transcription as any).duration;
    
    console.log(`✅ [${requestId}] OpenAI response received:`, {
      responseFormat: responseFormat,
      text: transcribedText,
      language: detectedLanguage,
      duration: duration,
      whisperLatency: whisperLatency + 'ms'
    });

    // Determine if it's English or Spanish
    let language = 'unknown';
    
    // Use language hint if provided, otherwise try to detect
    if (languageHint) {
      language = languageHint;
      console.log(`🎯 [${requestId}] Using language hint: ${language}`);
    } else if (detectedLanguage === 'en' || detectedLanguage === 'english') {
      language = 'en';
    } else if (detectedLanguage === 'es' || detectedLanguage === 'spanish') {
      language = 'es';
    } else {
      // For other detected languages or text format, try to guess based on common English/Spanish patterns
      const text = transcribedText?.toLowerCase() || '';
      const spanishWords = ['la', 'el', 'de', 'que', 'y', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da', 'su', 'por', 'son', 'con', 'para', 'una', 'está', 'más', 'muy', 'pero', 'todo', 'ser', 'tienen', 'hacer', 'bueno', 'buena', 'gracias', 'hola', 'sí', 'como'];
      const englishWords = ['the', 'and', 'you', 'that', 'was', 'for', 'are', 'with', 'his', 'they', 'have', 'this', 'will', 'your', 'from', 'him', 'her', 'been', 'than', 'now', 'were', 'said', 'each', 'which', 'their', 'time', 'hello', 'yes', 'thank', 'thanks'];
      
      const words = text.split(/\s+/);
      let spanishCount = 0;
      let englishCount = 0;
      
      words.forEach(word => {
        if (spanishWords.includes(word)) spanishCount++;
        if (englishWords.includes(word)) englishCount++;
      });
      
      if (spanishCount > englishCount && spanishCount > 0) {
        language = 'es';
      } else if (englishCount > spanishCount && englishCount > 0) {
        language = 'en';
      }
      // Otherwise remain 'unknown'
    }

    // Translate the text if we have a valid transcription
    let translatedText = '';
    let translationLatency = 0;
    let translationService = 'none';
    if (transcription.text && transcription.text.trim() && language !== 'unknown') {
      const selectedService = url.searchParams.get('translator') || 'gpt4';
      console.log(`🌐 [${requestId}] Starting translation with ${selectedService}...`);
      try {
        const translationStartTime = Date.now();
        
        // Choose translation service based on URL parameter
        const translatorParam = url.searchParams.get('translator');
        console.log(`🔍 [${requestId}] URL translator param: "${translatorParam}"`);
        
        if (translatorParam === 'google') {
          console.log(`🌐 [${requestId}] Selecting Google Translate`);
          translatedText = await translateWithGoogle(transcription.text, language, requestId);
          translationService = 'google';
        } else {
          console.log(`🤖 [${requestId}] Selecting GPT-4 (default)`);
          translatedText = await translateWithGPT4(transcription.text, language, requestId);
          translationService = 'gpt4';
        }

        const translationEndTime = Date.now();
        translationLatency = translationEndTime - translationStartTime;

        console.log(`✅ [${requestId}] Translation completed with ${translationService}:`, {
          translatedText,
          translationLatency: translationLatency + 'ms',
          service: translationService
        });
        
      } catch (translationError) {
        console.error(`❌ [${requestId}] Translation error with ${translationService}:`, translationError);
        // Don't fail the entire request if translation fails
        translatedText = ''; 
      }
    }

    const totalEndTime = Date.now();
    const totalLatency = totalEndTime - startTime;

    const response = {
      text: transcribedText,
      translatedText: translatedText,
      language: language,
      detected_language: detectedLanguage,
      duration: duration,
      translationService: translationService,
      whisperConfig: {
        model: whisperModel,
        language: languageHint,
        format: responseFormat,
        temperature: temperatureParam,
        optimize: optimize
      },
      serverLatency: {
        total: totalLatency,
        whisper: whisperLatency,
        translation: translationLatency
      }
    };

    console.log(`📤 [${requestId}] Sending response:`, {
      ...response,
      totalLatency: totalLatency + 'ms'
    });
    return NextResponse.json(response);

  } catch (error) {
    const errorEndTime = Date.now();
    const errorLatency = errorEndTime - startTime;
    
    console.error(`❌ [${requestId}] === TRANSCRIPTION ERROR ===`);
    console.error(`[${requestId}] Error type:`, error?.constructor?.name);
    console.error(`[${requestId}] Error message:`, error instanceof Error ? error.message : 'Unknown error');
    console.error(`[${requestId}] Full error:`, error);
    console.error(`[${requestId}] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
    console.error(`[${requestId}] Request failed after:`, errorLatency + 'ms');
    
    if (error instanceof Error) {
      // Check for specific OpenAI errors
      if (error.message.includes('API key')) {
        console.error(`🔑 [${requestId}] API Key issue detected`);
        return NextResponse.json(
          { error: `OpenAI API Key error: ${error.message}`, requestId },
          { status: 401 }
        );
      }
      
      if (error.message.includes('quota') || error.message.includes('billing')) {
        console.error(`💰 [${requestId}] Billing/quota issue detected`);
        return NextResponse.json(
          { error: `OpenAI billing/quota error: ${error.message}`, requestId },
          { status: 402 }
        );
      }

      return NextResponse.json(
        { error: `Transcription failed: ${error.message}`, requestId },
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      { error: 'Unknown transcription error - check server logs', requestId },
      { status: 500 }
    );
  }
}
