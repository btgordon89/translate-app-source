import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

// Initialize OpenAI client lazily to avoid build-time issues
let openai: OpenAI | null = null;

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

export async function POST(request: NextRequest) {
  console.log('🔥 === TRANSCRIPTION API CALLED ===');
  
  try {
    console.log('📥 Parsing form data...');
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    console.log('📄 Audio file info:', {
      exists: !!audioFile,
      name: audioFile?.name,
      size: audioFile?.size,
      type: audioFile?.type
    });

    if (!audioFile) {
      console.error('❌ No audio file provided');
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (audioFile.size === 0) {
      console.error('❌ Audio file is empty');
      return NextResponse.json({ error: 'Audio file is empty' }, { status: 400 });
    }

    console.log('🔧 Converting audio file...');
    // Convert the audio file to the format expected by OpenAI using toFile helper
    const arrayBuffer = await audioFile.arrayBuffer();
    console.log('📦 Audio buffer size:', arrayBuffer.byteLength);

    console.log('🤖 Calling OpenAI Whisper API...');
    console.log('🔑 API Key present:', !!process.env.OPENAI_API_KEY);
    console.log('🔑 API Key preview:', process.env.OPENAI_API_KEY?.substring(0, 10) + '...');

    // Use OpenAI toFile helper for proper file handling
    const audioFile2 = await toFile(arrayBuffer, 'audio.webm', { type: 'audio/webm' });
    console.log('📄 File object created successfully');

    // Use OpenAI Whisper API for transcription
    const client = getOpenAIClient();
    const transcription = await client.audio.transcriptions.create({
      file: audioFile2,
      model: 'whisper-1',
      language: undefined, // Let Whisper auto-detect between English and Spanish
      response_format: 'verbose_json', // Get detailed response with language detection
    });

    console.log('✅ OpenAI response received:', {
      text: transcription.text,
      language: transcription.language,
      duration: transcription.duration
    });

    // Determine if it's English or Spanish
    const detectedLanguage = transcription.language;
    let language = 'unknown';
    
    if (detectedLanguage === 'en' || detectedLanguage === 'english') {
      language = 'en';
    } else if (detectedLanguage === 'es' || detectedLanguage === 'spanish') {
      language = 'es';
    } else {
      // For other detected languages, try to guess based on common English/Spanish patterns
      const text = transcription.text?.toLowerCase() || '';
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
    if (transcription.text && transcription.text.trim() && language !== 'unknown') {
      console.log('🌐 Starting translation...');
      try {
        // Determine translation direction
        const sourceLanguage = language === 'en' ? 'English' : 'Mexican Spanish';
        const targetLanguage = language === 'en' ? 'Mexican Spanish' : 'English';
        
        console.log(`🔄 Translating from ${sourceLanguage} to ${targetLanguage}`);
        
        // Use GPT-4 for high-quality translation
        const translationPrompt = language === 'en' 
          ? `Translate the following English text to Mexican Spanish (not Spain Spanish). Keep the tone and style natural and conversational as if spoken between a couple. Only return the translation, no explanations:\n\n"${transcription.text}"`
          : `Translate the following Mexican Spanish text to English. Keep the tone and style natural and conversational as if spoken between a couple. Only return the translation, no explanations:\n\n"${transcription.text}"`;

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

        translatedText = translationResponse.choices[0]?.message?.content?.trim() || '';
        console.log('✅ Translation completed:', translatedText);
        
      } catch (translationError) {
        console.error('❌ Translation error:', translationError);
        // Don't fail the entire request if translation fails
        translatedText = ''; 
      }
    }

    const response = {
      text: transcription.text,
      translatedText: translatedText,
      language: language,
      detected_language: detectedLanguage,
      duration: transcription.duration
    };

    console.log('📤 Sending response:', response);
    return NextResponse.json(response);

  } catch (error) {
    console.error('❌ === TRANSCRIPTION ERROR ===');
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Full error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    if (error instanceof Error) {
      // Check for specific OpenAI errors
      if (error.message.includes('API key')) {
        console.error('🔑 API Key issue detected');
        return NextResponse.json(
          { error: `OpenAI API Key error: ${error.message}` },
          { status: 401 }
        );
      }
      
      if (error.message.includes('quota') || error.message.includes('billing')) {
        console.error('💰 Billing/quota issue detected');
        return NextResponse.json(
          { error: `OpenAI billing/quota error: ${error.message}` },
          { status: 402 }
        );
      }

      return NextResponse.json(
        { error: `Transcription failed: ${error.message}` },
        { status: 500 }
      );
    }
    
    return NextResponse.json(
      { error: 'Unknown transcription error - check server logs' },
      { status: 500 }
    );
  }
}
