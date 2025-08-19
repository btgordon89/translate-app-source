'use client';

import { useState, useRef, useEffect } from 'react';

interface TranscriptionResult {
  text: string;
  translatedText?: string;
  language: string;
  timestamp: number;
  isTranslating?: boolean; // Progressive display: show when translation is in progress
  testMetrics?: {
    chunkSize: number;
    latency: number;
    apiLatency: number;
    chunkIndex: number;
  };
}

export default function TranscribePage() {
  const [isListening, setIsListening] = useState(false);
  const [transcriptions, setTranscriptions] = useState<TranscriptionResult[]>([]);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [audioAnalysisStatus, setAudioAnalysisStatus] = useState<string>('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState<any[]>([]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptionAreaRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Auto-scroll to bottom when new transcriptions are added
  useEffect(() => {
    if (transcriptionAreaRef.current) {
      transcriptionAreaRef.current.scrollTop = transcriptionAreaRef.current.scrollHeight;
    }
  }, [transcriptions]);

  // Calculate RMS (Root Mean Square) energy of audio data
  const calculateAudioRMS = async (audioBlob: Blob): Promise<number> => {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Get audio data from first channel
      const channelData = audioBuffer.getChannelData(0);
      
      // Calculate RMS
      let sumSquares = 0;
      for (let i = 0; i < channelData.length; i++) {
        sumSquares += channelData[i] * channelData[i];
      }
      const rms = Math.sqrt(sumSquares / channelData.length);
      
      // Convert to decibels (approximate)
      const decibels = 20 * Math.log10(rms);
      
      console.log('🔊 Audio RMS Analysis:', {
        rms: rms.toFixed(6),
        decibels: decibels.toFixed(2) + ' dB',
        duration: audioBuffer.duration.toFixed(2) + 's'
      });
      
      audioContext.close();
      return decibels;
    } catch (error) {
      console.error('❌ Error calculating audio RMS:', error);
      return -60; // Default to low value if analysis fails
    }
  };

  const startListening = async () => {
    try {
      setError('');
      setIsLoading(true);

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        } 
      });
      
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm; codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          await sendAudioForTranscription(audioBlob);
          audioChunksRef.current = [];
        }
      };

      // Record in 1.5-second chunks for faster response (optimized from 3s)
      mediaRecorder.start();
      setIsListening(true);
      setIsLoading(false);

      // Set up interval to process audio chunks - optimized for speed
      const interval = setInterval(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.start();
        }
      }, 1500); // Reduced from 3000ms to 1500ms for 50% faster response

      // Store interval for cleanup
      (mediaRecorderRef.current as any).intervalId = interval;

    } catch (err) {
      console.error('Error starting audio recording:', err);
      setError('Failed to access microphone. Please ensure microphone permissions are granted.');
      setIsLoading(false);
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current) {
      const intervalId = (mediaRecorderRef.current as any).intervalId;
      if (intervalId) {
        clearInterval(intervalId);
      }
      
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    setIsListening(false);
  };

  const sendAudioForTranscription = async (audioBlob: Blob) => {
    try {
      console.log('📤 Analyzing audio chunk...', {
        size: audioBlob.size,
        type: audioBlob.type
      });

      // Calculate audio RMS to determine if chunk contains meaningful audio
      const audioDecibels = await calculateAudioRMS(audioBlob);
      const RMS_THRESHOLD = -45; // Minimum decibel level to process (adjust as needed)
      
      if (audioDecibels < RMS_THRESHOLD) {
        console.log('🔇 Audio too quiet, skipping transcription:', {
          decibels: audioDecibels.toFixed(2) + ' dB',
          threshold: RMS_THRESHOLD + ' dB'
        });
        setAudioAnalysisStatus(`🔇 Audio too quiet (${audioDecibels.toFixed(1)} dB)`);
        setTimeout(() => setAudioAnalysisStatus(''), 2000); // Clear after 2 seconds
        return; // Skip this chunk - too quiet
      }

      console.log('✅ Audio above threshold, sending for transcription:', {
        decibels: audioDecibels.toFixed(2) + ' dB',
        threshold: RMS_THRESHOLD + ' dB'
      });
      setAudioAnalysisStatus(`🔊 Processing audio (${audioDecibels.toFixed(1)} dB)`);

      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      console.log('📥 Transcription API response:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error Response:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Transcription result:', result);
      
      if (result.error) {
        throw new Error(`API Error: ${result.error}`);
      }
      
      if (result.text && result.text.trim()) {
        const trimmedText = result.text.trim();
        const MIN_TEXT_LENGTH = 3; // Minimum number of words to consider valid
        const wordCount = trimmedText.split(/\s+/).length;
        
        if (wordCount < MIN_TEXT_LENGTH) {
          console.log('📏 Text too short, skipping:', {
            text: trimmedText,
            wordCount: wordCount,
            minRequired: MIN_TEXT_LENGTH
          });
          return; // Skip short transcriptions (likely noise)
        }

        const newTranscription: TranscriptionResult = {
          text: trimmedText,
          translatedText: result.translatedText || '',
          language: result.language || 'unknown',
          timestamp: Date.now()
        };
        
        console.log('📝 Adding transcription:', newTranscription);
        setTranscriptions(prev => [...prev, newTranscription]);
        setAudioAnalysisStatus(''); // Clear status after successful transcription
      } else {
        console.log('⚠️ No text returned from transcription');
      }
    } catch (err) {
      console.error('❌ Error transcribing audio:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`Transcription failed: ${errorMessage}`);
    }
  };

  const clearTranscriptions = () => {
    setTranscriptions([]);
    setTestResults([]);
  };

  // Real API Testing with actual MP3 file
  const runRealAPISpeedTest = async () => {
    setIsTesting(true);
    setError('');
    setAudioAnalysisStatus('🔬 Starting real API speed test...');
    
    try {
      // Load the test audio file
      const response = await fetch('/test-audio.mp3');
      if (!response.ok) {
        throw new Error('Could not load test audio file');
      }
      
      const audioBuffer = await response.arrayBuffer();
      console.log('📁 Loaded test audio:', (audioBuffer.byteLength / 1024).toFixed(1) + ' KB');
      
      // Test different chunk sizes with real API calls
      const chunkSizes = [1.0, 1.5, 2.0, 3.0]; // seconds
      const testResultsTemp: any[] = [];
      
      setAudioAnalysisStatus('🎯 Testing chunk sizes: 1.0s, 1.5s, 2.0s, 3.0s...');
      
      for (let i = 0; i < chunkSizes.length; i++) {
        const chunkSize = chunkSizes[i];
        console.log(`\n🔬 Testing ${chunkSize}s chunks...`);
        setAudioAnalysisStatus(`🔬 Testing ${chunkSize}s chunks... (${i + 1}/${chunkSizes.length})`);
        
        try {
          // Create a real audio chunk using Web Audio API
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const audioBufferDecoded = await audioContext.decodeAudioData(audioBuffer.slice(0));
          
          // Extract chunk from beginning of audio
          const chunkSamples = Math.floor(chunkSize * audioBufferDecoded.sampleRate);
          const chunkBuffer = audioContext.createBuffer(
            audioBufferDecoded.numberOfChannels,
            chunkSamples,
            audioBufferDecoded.sampleRate
          );
          
          // Copy audio data for the chunk
          for (let channel = 0; channel < audioBufferDecoded.numberOfChannels; channel++) {
            const sourceData = audioBufferDecoded.getChannelData(channel);
            const chunkData = chunkBuffer.getChannelData(channel);
            for (let sample = 0; sample < chunkSamples && sample < sourceData.length; sample++) {
              chunkData[sample] = sourceData[sample];
            }
          }
          
          // Convert chunk to blob (simplified - using original audio format)
          const chunkStartByte = 0;
          const chunkSizeBytes = Math.floor((audioBuffer.byteLength * chunkSize) / 28.55); // proportional to total duration
          const chunkArrayBuffer = audioBuffer.slice(chunkStartByte, chunkStartByte + chunkSizeBytes);
          const audioBlob = new Blob([chunkArrayBuffer], { type: 'audio/mp3' });
          
          console.log(`📦 Created ${chunkSize}s chunk:`, (audioBlob.size / 1024).toFixed(1) + ' KB');
          
          // Send through real API pipeline
          const startTime = Date.now();
          const result = await sendAudioForTranscriptionWithMetrics(audioBlob, chunkSize, i);
          const endTime = Date.now();
          
          const testResult = {
            chunkSize,
            latency: endTime - startTime,
            success: !!result,
            transcription: result?.text || '',
            translation: result?.translatedText || '',
            error: result?.error || null,
            chunkIndex: i,
            timestamp: new Date().toISOString()
          };
          
          testResultsTemp.push(testResult);
          console.log(`✅ ${chunkSize}s test completed:`, testResult.latency + 'ms');
          
          // Add to transcriptions with test metrics
          if (result && result.text) {
            const newTranscription: TranscriptionResult = {
              text: `[TEST ${chunkSize}s] ${result.text}`,
              translatedText: result.translatedText,
              language: result.language || 'en',
              timestamp: Date.now(),
              testMetrics: {
                chunkSize,
                latency: testResult.latency,
                apiLatency: testResult.latency, // Same for now
                chunkIndex: i
              }
            };
            setTranscriptions(prev => [...prev, newTranscription]);
          }
          
          // Small delay between tests
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (chunkError) {
          console.error(`❌ ${chunkSize}s chunk test failed:`, chunkError);
          testResultsTemp.push({
            chunkSize,
            latency: 0,
            success: false,
            error: chunkError instanceof Error ? chunkError.message : 'Unknown error',
            chunkIndex: i,
            timestamp: new Date().toISOString()
          });
        }
      }
      
      setTestResults(testResultsTemp);
      
      // Generate performance summary
      const successfulTests = testResultsTemp.filter(t => t.success);
      if (successfulTests.length > 0) {
        const fastest = successfulTests.reduce((min, current) => 
          current.latency < min.latency ? current : min
        );
        
        setAudioAnalysisStatus(
          `✅ Testing complete! Fastest: ${fastest.chunkSize}s chunks (${fastest.latency}ms) | ` +
          `${successfulTests.length}/${testResultsTemp.length} tests successful`
        );
        
        console.log('\n🏆 REAL API TEST RESULTS:');
        successfulTests.forEach(test => {
          console.log(`${test.chunkSize}s chunks: ${test.latency}ms`);
        });
        console.log(`\n🥇 Winner: ${fastest.chunkSize}s chunks at ${fastest.latency}ms`);
      } else {
        setAudioAnalysisStatus('❌ All tests failed - check console for details');
      }
      
    } catch (error) {
      console.error('❌ Real API speed test failed:', error);
      setError(`Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setAudioAnalysisStatus('❌ Test failed - see error above');
    } finally {
      setIsTesting(false);
    }
  };

  // Enhanced sendAudioForTranscription with metrics
  const sendAudioForTranscriptionWithMetrics = async (audioBlob: Blob, chunkSize?: number, chunkIndex?: number) => {
    try {
      const apiStartTime = Date.now();
      
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.mp3');

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      const apiEndTime = Date.now();
      const apiLatency = apiEndTime - apiStartTime;

      console.log(`📥 API response (${chunkSize}s chunk):`, {
        status: response.status,
        latency: apiLatency + 'ms'
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(`API Error: ${result.error}`);
      }
      
      return {
        ...result,
        apiLatency,
        chunkSize,
        chunkIndex
      };
      
    } catch (err) {
      console.error('❌ API call failed:', err);
      return {
        error: err instanceof Error ? err.message : 'Unknown error',
        chunkSize,
        chunkIndex
      };
    }
  };

  // Simple authentication check - redirect if not coming from main page
  useEffect(() => {
    if (!document.referrer.includes(window.location.origin)) {
      window.location.href = '/';
    }
  }, []);

  return (
    <div style={{ 
      backgroundColor: 'black', 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      padding: '1rem',
      fontFamily: 'monospace'
    }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '1rem'
      }}>
        <h1 style={{ 
          color: 'white', 
          fontSize: '1.5rem', 
          margin: 0
        }}>
          Real-Time Translation
        </h1>
        <button
          onClick={clearTranscriptions}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#333',
            color: 'white',
            border: '1px solid #555',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Clear
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{ 
          color: '#ff6b6b', 
          marginBottom: '1rem',
          padding: '0.5rem',
          backgroundColor: '#2d1b1b',
          borderRadius: '4px',
          border: '1px solid #ff6b6b'
        }}>
          {error}
        </div>
      )}

      {/* Transcription Display */}
      <div 
        ref={transcriptionAreaRef}
        style={{ 
          flex: 1,
          backgroundColor: '#111',
          border: '1px solid #333',
          borderRadius: '8px',
          padding: '1rem',
          overflowY: 'auto',
          marginBottom: '1rem',
          color: 'white',
          fontSize: '1.1rem',
          lineHeight: '1.6'
        }}
      >
        {transcriptions.length === 0 ? (
          <div style={{ color: '#666', fontStyle: 'italic' }}>
            Press "Start Listening" to begin real-time translation...
          </div>
        ) : (
          transcriptions.map((transcription, index) => (
            <div key={index} style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#1a1a1a', borderRadius: '6px', border: '1px solid #333' }}>
              {/* Test Metrics Header (if available) */}
              {transcription.testMetrics && (
                <div style={{ 
                  marginBottom: '0.5rem', 
                  padding: '0.25rem 0.5rem', 
                  backgroundColor: '#2563eb20', 
                  borderRadius: '4px',
                  fontSize: '0.7rem',
                  color: '#60a5fa',
                  border: '1px solid #2563eb40'
                }}>
                  🔬 Test #{transcription.testMetrics.chunkIndex + 1}: {transcription.testMetrics.chunkSize}s chunk | 
                  Latency: {transcription.testMetrics.latency}ms | 
                  API: {transcription.testMetrics.apiLatency}ms
                </div>
              )}
              
              {/* Original Text */}
              <div style={{ marginBottom: '0.5rem' }}>
                <span style={{ 
                  color: transcription.language === 'en' ? '#4ade80' : '#fbbf24',
                  fontSize: '0.8rem',
                  marginRight: '0.5rem',
                  fontWeight: 'bold'
                }}>
                  [{transcription.language === 'en' ? 'EN' : 'ES'}]
                </span>
                <span style={{ color: '#e5e5e5' }}>{transcription.text}</span>
              </div>
              
              {/* Translated Text */}
              {transcription.translatedText && (
                <div style={{ 
                  paddingLeft: '1rem', 
                  borderLeft: '3px solid #374151',
                  marginLeft: '1.5rem'
                }}>
                  <span style={{ 
                    color: transcription.language === 'en' ? '#fbbf24' : '#4ade80',
                    fontSize: '0.8rem',
                    marginRight: '0.5rem',
                    fontWeight: 'bold'
                  }}>
                    [{transcription.language === 'en' ? 'ES' : 'EN'}]
                  </span>
                  <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>{transcription.translatedText}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Controls */}
      <div style={{ 
        display: 'flex', 
        gap: '1rem',
        justifyContent: 'center',
        flexWrap: 'wrap'
      }}>
        <button
          onClick={isListening ? stopListening : startListening}
          disabled={isLoading || isTesting}
          style={{
            padding: '1rem 2rem',
            fontSize: '1.1rem',
            backgroundColor: isListening ? '#dc2626' : '#16a34a',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: (isLoading || isTesting) ? 'not-allowed' : 'pointer',
            minWidth: '200px',
            opacity: (isLoading || isTesting) ? 0.7 : 1
          }}
        >
          {isLoading ? 'Starting...' : isListening ? 'Stop Listening' : 'Start Listening'}
        </button>
        
        <button
          onClick={runRealAPISpeedTest}
          disabled={isLoading || isListening || isTesting}
          style={{
            padding: '1rem 2rem',
            fontSize: '1.1rem',
            backgroundColor: isTesting ? '#dc2626' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: (isLoading || isListening || isTesting) ? 'not-allowed' : 'pointer',
            minWidth: '200px',
            opacity: (isLoading || isListening || isTesting) ? 0.7 : 1
          }}
        >
          {isTesting ? 'Testing...' : '🔬 Test Speed (Real API)'}
        </button>
      </div>

      {/* Status */}
      <div style={{ 
        textAlign: 'center', 
        marginTop: '1rem',
        color: '#666',
        fontSize: '0.9rem',
        minHeight: '2rem'
      }}>
        {isListening && (
          <div style={{ color: '#16a34a' }}>
            🎤 Listening... Recording in 1.5-second chunks (optimized for speed)
          </div>
        )}
        {audioAnalysisStatus && (
          <div style={{ 
            color: audioAnalysisStatus.includes('too quiet') ? '#fbbf24' : '#3b82f6',
            marginTop: '0.5rem',
            fontSize: '0.8rem'
          }}>
            {audioAnalysisStatus}
          </div>
        )}
      </div>
    </div>
  );
}
