import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const { Translate } = require('@google-cloud/translate').v2;

// Initialize Google Translate client lazily
let googleTranslate: any = null;

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

async function transcribeWithLocalWhisper(audioBuffer: Buffer, requestId: string, modelSize: string = "small"): Promise<any> {
  console.log(`🎵 [${requestId}] Starting local Faster-Whisper transcription with model: ${modelSize}...`);
  
  const startTime = Date.now();
  
  // Create temporary file for audio
  const tempFilePath = join(tmpdir(), `audio_${requestId}_${Date.now()}.webm`);
  
  try {
    // Write audio buffer to temporary file
    await writeFile(tempFilePath, audioBuffer);
    console.log(`📄 [${requestId}] Wrote audio to temp file: ${tempFilePath}`);
    
    // Run Python transcription script with model size parameter
    const pythonScriptPath = join(process.cwd(), 'scripts', 'local_transcribe.py');
    console.log(`🐍 [${requestId}] Running Python script: ${pythonScriptPath} with model ${modelSize}`);
    
    return new Promise((resolve, reject) => {
      const pythonProcess = spawn('python3', [pythonScriptPath, tempFilePath, modelSize]);
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        const stderrData = data.toString();
        stderr += stderrData;
        // Log Python stderr in real-time for better debugging
        console.log(`🐍 [${requestId}] Python stderr: ${stderrData.trim()}`);
      });
      
      pythonProcess.on('close', async (code) => {
        // Clean up temp file
        try {
          await unlink(tempFilePath);
          console.log(`🗑️ [${requestId}] Cleaned up temp file`);
        } catch (cleanupError) {
          console.warn(`⚠️ [${requestId}] Failed to cleanup temp file:`, cleanupError);
        }
        
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            
            // Enhanced logging for debugging
            const textLength = result.text ? result.text.length : 0;
            const isEmpty = textLength === 0;
            const isRepetitive = result.text && result.text.length > 100 && 
              (result.text.match(/(.{20,})\1{2,}/g) !== null);
            
            console.log(`✅ [${requestId}] Local transcription completed in ${totalTime}ms:`, {
              ...result,
              textLength,
              isEmpty,
              isRepetitive,
              transcriptionMsActual: result.timing?.transcription_ms || 'unknown'
            });
            
            if (isEmpty) {
              console.warn(`⚠️ [${requestId}] WARNING: Empty transcription result detected`);
            }
            if (isRepetitive) {
              console.warn(`⚠️ [${requestId}] WARNING: Potentially repetitive transcription detected`);
            }
            
            resolve(result);
          } catch (parseError) {
            console.error(`❌ [${requestId}] Failed to parse Python output:`, stdout);
            console.error(`❌ [${requestId}] Parse error:`, parseError);
            reject(new Error(`Failed to parse transcription result: ${parseError}`));
          }
        } else {
          console.error(`❌ [${requestId}] Python script failed with code ${code}`);
          console.error(`❌ [${requestId}] Python stderr:`, stderr);
          console.error(`❌ [${requestId}] Python stdout:`, stdout);
          reject(new Error(`Local transcription failed: ${stderr || stdout || 'Unknown error'}`));
        }
      });
      
      pythonProcess.on('error', (error) => {
        console.error(`❌ [${requestId}] Python process error:`, error);
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });
    });
    
  } catch (error) {
    // Clean up temp file on error
    try {
      await unlink(tempFilePath);
    } catch (cleanupError) {
      console.warn(`⚠️ [${requestId}] Failed to cleanup temp file on error:`, cleanupError);
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  
  // Get model size from URL parameters (default to small for GPU)
  const url = new URL(request.url);
  const modelSize = url.searchParams.get('model') || 'small';
  
  console.log('🚀 === LOCAL TRANSCRIPTION API CALLED ===', {
    requestId,
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get('user-agent'),
    contentType: request.headers.get('content-type'),
    url: request.url,
    modelSize: modelSize
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

    // Convert audio file to buffer
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    console.log(`📦 [${requestId}] Audio buffer size:`, audioBuffer.length, 'bytes');

    // Transcribe with local Faster-Whisper
    const whisperStartTime = Date.now();
    const transcriptionResult = await transcribeWithLocalWhisper(audioBuffer, requestId, modelSize);
    const whisperEndTime = Date.now();
    const whisperLatency = whisperEndTime - whisperStartTime;

    const transcribedText = transcriptionResult.text;
    const detectedLanguage = transcriptionResult.language;
    
    console.log(`✅ [${requestId}] Local Whisper response:`, {
      text: transcribedText,
      language: detectedLanguage,
      whisperLatency: whisperLatency + 'ms',
      pythonTiming: transcriptionResult.timing
    });

    // Determine language for translation
    let language = 'unknown';
    if (detectedLanguage === 'en' || detectedLanguage === 'english') {
      language = 'en';
    } else if (detectedLanguage === 'es' || detectedLanguage === 'spanish') {
      language = 'es';
    } else {
      // Simple language detection fallback
      const text = transcribedText?.toLowerCase() || '';
      const spanishWords = ['la', 'el', 'de', 'que', 'y', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da', 'su', 'por', 'son', 'con', 'para', 'una', 'está', 'más', 'muy', 'pero', 'todo', 'ser', 'tienen', 'hacer', 'bueno', 'buena', 'gracias', 'hola', 'sí', 'como'];
      const englishWords = ['the', 'and', 'you', 'that', 'was', 'for', 'are', 'with', 'his', 'they', 'have', 'this', 'will', 'your', 'from', 'him', 'her', 'been', 'than', 'now', 'were', 'said', 'each', 'which', 'their', 'time', 'hello', 'yes', 'thank', 'thanks'];
      
      const words = text.split(/\s+/);
      let spanishCount = 0;
      let englishCount = 0;
      
      words.forEach((word: string) => {
        if (spanishWords.includes(word)) spanishCount++;
        if (englishWords.includes(word)) englishCount++;
      });
      
      if (spanishCount > englishCount && spanishCount > 0) {
        language = 'es';
      } else if (englishCount > spanishCount && englishCount > 0) {
        language = 'en';
      }
    }

    // Translate the text if we have a valid transcription
    let translatedText = '';
    let translationLatency = 0;
    if (transcribedText && transcribedText.trim() && language !== 'unknown') {
      console.log(`🌐 [${requestId}] Starting translation with Google...`);
      try {
        const translationStartTime = Date.now();
        translatedText = await translateWithGoogle(transcribedText, language, requestId);
        const translationEndTime = Date.now();
        translationLatency = translationEndTime - translationStartTime;

        console.log(`✅ [${requestId}] Translation completed:`, {
          translatedText,
          translationLatency: translationLatency + 'ms'
        });
        
      } catch (translationError) {
        console.error(`❌ [${requestId}] Translation error:`, translationError);
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
      duration: transcriptionResult.duration,
      translationService: 'google',
      transcriptionService: 'faster-whisper-local',
      device: transcriptionResult.device,
      compute_type: transcriptionResult.compute_type,
      model_size: transcriptionResult.model_size,
      beam_size: transcriptionResult.beam_size,
      vad_filter: transcriptionResult.vad_filter,
      pythonTiming: transcriptionResult.timing,
      serverLatency: {
        total: totalLatency,
        whisper: whisperLatency,
        translation: translationLatency
      }
    };

    console.log(`📤 [${requestId}] Sending local transcription response:`, {
      ...response,
      totalLatency: totalLatency + 'ms'
    });
    
    return NextResponse.json(response);

  } catch (error) {
    const errorEndTime = Date.now();
    const errorLatency = errorEndTime - startTime;
    
    console.error(`❌ [${requestId}] === LOCAL TRANSCRIPTION ERROR ===`);
    console.error(`[${requestId}] Error type:`, error?.constructor?.name);
    console.error(`[${requestId}] Error message:`, error instanceof Error ? error.message : 'Unknown error');
    console.error(`[${requestId}] Full error:`, error);
    console.error(`[${requestId}] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
    console.error(`[${requestId}] Request failed after:`, errorLatency + 'ms');
    
    if (error instanceof Error) {
      return NextResponse.json(
        { error: `Local transcription failed: ${error.message}`, requestId },
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      { error: 'Unknown local transcription error - check server logs', requestId },
      { status: 500 }
    );
  }
}
