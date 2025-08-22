'use client';

import { useState, useRef, useEffect } from 'react';

interface TranscriptionResult {
  text: string;
  translatedText?: string;
  language: string;
  timestamp: number;
  translationService?: string;
  isTranslating?: boolean; // Progressive display: show when translation is in progress
  serverLatency?: {
    total: number;
    whisper: number;
    translation: number;
  };
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
  const [currentTranscript, setCurrentTranscript] = useState<TranscriptionResult | null>(null);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [audioAnalysisStatus, setAudioAnalysisStatus] = useState<string>('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState<any[]>([]);
  const [translationService, setTranslationService] = useState<'gpt4' | 'google'>('google');
  const [transcriptionService, setTranscriptionService] = useState<'openai' | 'local'>('openai');
  const [performanceMode, setPerformanceMode] = useState<'optimized' | 'standard'>('optimized');
  const [scrollPosition, setScrollPosition] = useState(0);

  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Teleprompter scrolling effect
  useEffect(() => {
    if (isListening) {
      // Start smooth upward scrolling when listening
      scrollIntervalRef.current = setInterval(() => {
        setScrollPosition(prev => prev + 2); // Scroll up 2px every 100ms = 20px/second
      }, 100);
    } else {
      // Stop scrolling when not listening
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
      }
    }

    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, [isListening]);

  // Sync scroll position between both panes
  useEffect(() => {
    if (leftPaneRef.current) {
      leftPaneRef.current.scrollTop = scrollPosition;
    }
    if (rightPaneRef.current) {
      rightPaneRef.current.scrollTop = scrollPosition;
    }
  }, [scrollPosition]);

  // Calculate RMS (Root Mean Square) energy of audio data
  const calculateAudioRMS = async (audioBlob: Blob): Promise<number> => {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);
      
      let sum = 0;
      for (let i = 0; i < channelData.length; i++) {
        sum += channelData[i] * channelData[i];
      }
      
      const rms = Math.sqrt(sum / channelData.length);
      const decibels = 20 * Math.log10(rms);
      
      return decibels;
    } catch (error) {
      console.warn('Could not calculate audio RMS:', error);
      return -30; // Default to a reasonable threshold if calculation fails
    }
  };

  const startListening = async () => {
    try {
      setIsLoading(true);
      setError('');
      
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

      // Record in 1.5-second chunks for maximum speed
      mediaRecorder.start();
      setIsListening(true);
      setIsLoading(false);

      // Set up interval to process audio chunks - optimized for maximum speed
      const interval = setInterval(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.start();
        }
      }, 1500); // 1.5 seconds - maximum speed while maintaining quality

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
    
    // Finalize current transcript when stopping
    if (currentTranscript) {
      setTranscriptions(prev => [...prev, currentTranscript]);
      setCurrentTranscript(null);
    }
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

      // Choose API endpoint based on transcription service
      let apiUrl: string;
      if (transcriptionService === 'local') {
        apiUrl = '/api/transcribe-local';
      } else {
        // Build optimized API URL based on performance mode
        apiUrl = `/api/transcribe?translator=${translationService}`;
        if (performanceMode === 'optimized') {
          apiUrl += '&format=text&language=en&temperature=0&optimize=true';
        }
      }
      
      const response = await fetch(apiUrl, {
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
        throw new Error(`Transcription API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('📝 Transcription result:', result);

      if (result.text && result.text.trim().length > 0) {
        const trimmedText = result.text.trim();
        const MIN_TEXT_LENGTH = 3; // Minimum characters to consider valid transcription
        
        if (trimmedText.length < MIN_TEXT_LENGTH) {
          console.log('⏭️ Skipping short transcription:', {
            text: trimmedText,
            length: trimmedText.length,
            minRequired: MIN_TEXT_LENGTH
          });
          return; // Skip short transcriptions (likely noise)
        }

        const newTranscription: TranscriptionResult = {
          text: trimmedText,
          translatedText: result.translatedText || '',
          language: result.language || 'unknown',
          timestamp: Date.now(),
          translationService: result.translationService || 'unknown',
          serverLatency: result.serverLatency
        };
        
        console.log('📝 Processing transcription chunk:', newTranscription);
        
        // Simple merging logic: if we have a current transcript less than 3 seconds old, merge it
        const now = Date.now();
        const MERGE_WINDOW_MS = 3000; // 3 seconds to merge chunks
        
        if (currentTranscript && (now - currentTranscript.timestamp) < MERGE_WINDOW_MS) {
          // Merge with current transcript
          console.log('🔄 Merging with current transcript');
          const mergedText = currentTranscript.text + ' ' + newTranscription.text;
          const mergedTranslation = (currentTranscript.translatedText || '') + ' ' + (newTranscription.translatedText || '');
          
          setCurrentTranscript({
            ...newTranscription,
            text: mergedText,
            translatedText: mergedTranslation,
            timestamp: now
          });
        } else {
          // Finalize current transcript and start new one
          if (currentTranscript) {
            console.log('⏰ Finalizing current transcript and starting new');
            setTranscriptions(prev => [...prev, currentTranscript]);
          }
          console.log('🆕 Starting new transcript');
          setCurrentTranscript(newTranscription);
        }
        
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
    setCurrentTranscript(null);
    setTestResults([]);
    setScrollPosition(0); // Reset scroll position
  };

  // Calculate spacing based on time gap between transcriptions
  const calculateTimeGapSpacing = (currentTimestamp: number, previousTimestamp?: number): number => {
    if (!previousTimestamp) return 0;
    
    const timeDiffSeconds = (currentTimestamp - previousTimestamp) / 1000;
    // Convert time gap to pixels: 1 second = 20px of spacing
    const spacing = Math.min(timeDiffSeconds * 20, 200); // Cap at 200px max spacing
    return spacing;
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
        
        {/* Performance Mode Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ color: 'white', fontSize: '0.9rem' }}>
            Speed: 
            <button
              onClick={() => setPerformanceMode('standard')}
              style={{
                marginLeft: '0.5rem',
                padding: '0.25rem 0.5rem',
                backgroundColor: performanceMode === 'standard' ? '#2563eb' : '#374151',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              Standard
            </button>
            <button
              onClick={() => setPerformanceMode('optimized')}
              style={{
                marginLeft: '0.25rem',
                padding: '0.25rem 0.5rem',
                backgroundColor: performanceMode === 'optimized' ? '#16a34a' : '#374151',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              OPTIMIZED ⚡
            </button>
          </div>
          
          {/* Transcription Service Toggle */}
          <div style={{ color: 'white', fontSize: '0.9rem' }}>
            Transcription: 
            <button
              onClick={() => setTranscriptionService('openai')}
              style={{
                marginLeft: '0.5rem',
                padding: '0.25rem 0.5rem',
                backgroundColor: transcriptionService === 'openai' ? '#2563eb' : '#374151',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              OpenAI
            </button>
            <button
              onClick={() => setTranscriptionService('local')}
              style={{
                marginLeft: '0.25rem',
                padding: '0.25rem 0.5rem',
                backgroundColor: transcriptionService === 'local' ? '#f59e0b' : '#374151',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              Local ⚡
            </button>
          </div>

          {/* Translation Service Toggle */}
          <div style={{ color: 'white', fontSize: '0.9rem' }}>
            Translator: 
            <button
              onClick={() => setTranslationService('gpt4')}
              style={{
                marginLeft: '0.5rem',
                padding: '0.25rem 0.5rem',
                backgroundColor: translationService === 'gpt4' ? '#2563eb' : '#374151',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              GPT-4
            </button>
            <button
              onClick={() => setTranslationService('google')}
              style={{
                marginLeft: '0.25rem',
                padding: '0.25rem 0.5rem',
                backgroundColor: translationService === 'google' ? '#16a34a' : '#374151',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              Google 🚀
            </button>
          </div>

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

      {/* Teleprompter Display - Dual Pane Layout */}
      <div style={{ 
        flex: 1,
        display: 'flex',
        gap: '1px',
        marginBottom: '1rem',
        backgroundColor: '#333', // Gap color between panes
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        {/* Left Pane - Original Text */}
        <div 
          ref={leftPaneRef}
          style={{ 
            flex: 1,
            backgroundColor: '#111',
            padding: '2rem 1rem',
            overflowY: 'auto',
            overflowX: 'hidden',
            color: 'white',
            fontSize: '1.3rem',
            lineHeight: '1.8',
            fontFamily: 'monospace',
            scrollbarWidth: 'none', // Firefox
            msOverflowStyle: 'none', // IE/Edge
            scrollBehavior: 'auto' // Disable smooth scrolling for teleprompter
          }}
        >
          <style>{`
            div::-webkit-scrollbar { display: none; } /* Chrome/Safari */
          `}</style>
          
          {transcriptions.length === 0 && !currentTranscript ? (
            <div style={{ 
              color: '#666', 
              fontStyle: 'italic',
              textAlign: 'center',
              marginTop: '50%'
            }}>
              Original Text
              <br />
              <small style={{ fontSize: '0.8rem' }}>Press "Start Listening" to begin...</small>
            </div>
          ) : (
            <>
              {/* Add spacer at top for teleprompter effect */}
              <div style={{ height: '80vh' }}></div>
              
              {/* Show finalized transcripts as flowing text */}
              {transcriptions.map((transcription, index) => {
                const prevTranscription = index > 0 ? transcriptions[index - 1] : undefined;
                const timeGapSpacing = calculateTimeGapSpacing(
                  transcription.timestamp, 
                  prevTranscription?.timestamp
                );
                
                return (
                  <div key={`original-${index}`} style={{ 
                    marginBottom: `${timeGapSpacing + 40}px`,
                    paddingBottom: '20px',
                    borderBottom: timeGapSpacing > 50 ? '1px solid #333' : 'none'
                  }}>
                    <div style={{ 
                      color: 'white',
                      marginBottom: '8px'
                    }}>
                      {transcription.text}
                    </div>
                  </div>
                );
              })}
              
              {/* Show current (live updating) transcript */}
              {currentTranscript && (
                <div style={{ 
                  marginBottom: '40px',
                  paddingBottom: '20px',
                  position: 'relative'
                }}>
                  <div style={{ 
                    position: 'absolute',
                    left: '-60px',
                    top: '0',
                    padding: '4px 8px',
                    backgroundColor: '#16a34a',
                    color: 'white',
                    borderRadius: '4px',
                    fontSize: '0.6rem',
                    fontWeight: 'bold'
                  }}>
                    LIVE
                  </div>
                  
                  <div style={{ 
                    color: 'white',
                    border: '1px solid #4ade80',
                    borderRadius: '4px',
                    padding: '10px',
                    backgroundColor: 'rgba(74, 222, 128, 0.1)'
                  }}>
                    {currentTranscript.text}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Pane - Translated Text */}
        <div 
          ref={rightPaneRef}
          style={{ 
            flex: 1,
            backgroundColor: '#111',
            padding: '2rem 1rem',
            overflowY: 'auto',
            overflowX: 'hidden',
            color: 'white',
            fontSize: '1.3rem',
            lineHeight: '1.8',
            fontFamily: 'monospace',
            scrollbarWidth: 'none', // Firefox
            msOverflowStyle: 'none', // IE/Edge
            scrollBehavior: 'auto' // Disable smooth scrolling for teleprompter
          }}
        >
          {transcriptions.length === 0 && !currentTranscript ? (
            <div style={{ 
              color: '#666', 
              fontStyle: 'italic',
              textAlign: 'center',
              marginTop: '50%'
            }}>
              Translated Text
              <br />
              <small style={{ fontSize: '0.8rem' }}>Press "Start Listening" to begin...</small>
            </div>
          ) : (
            <>
              {/* Add spacer at top for teleprompter effect */}
              <div style={{ height: '80vh' }}></div>
              
              {/* Show finalized transcripts as flowing text */}
              {transcriptions.map((transcription, index) => {
                const prevTranscription = index > 0 ? transcriptions[index - 1] : undefined;
                const timeGapSpacing = calculateTimeGapSpacing(
                  transcription.timestamp, 
                  prevTranscription?.timestamp
                );
                
                return (
                  <div key={`translated-${index}`} style={{ 
                    marginBottom: `${timeGapSpacing + 40}px`,
                    paddingBottom: '20px',
                    borderBottom: timeGapSpacing > 50 ? '1px solid #333' : 'none'
                  }}>
                    <div style={{ 
                      color: '#9ca3af', 
                      fontStyle: 'italic',
                      marginBottom: '8px'
                    }}>
                      {transcription.translatedText || 'Translating...'}
                    </div>
                  </div>
                );
              })}
              
              {/* Show current (live updating) transcript */}
              {currentTranscript && (
                <div style={{ 
                  marginBottom: '40px',
                  paddingBottom: '20px',
                  position: 'relative'
                }}>
                  <div style={{ 
                    position: 'absolute',
                    left: '-60px',
                    top: '0',
                    padding: '4px 8px',
                    backgroundColor: '#16a34a',
                    color: 'white',
                    borderRadius: '4px',
                    fontSize: '0.6rem',
                    fontWeight: 'bold'
                  }}>
                    LIVE
                  </div>
                  
                  <div style={{ 
                    color: '#9ca3af', 
                    fontStyle: 'italic',
                    border: '1px solid #4ade80',
                    borderRadius: '4px',
                    padding: '10px',
                    backgroundColor: 'rgba(74, 222, 128, 0.1)'
                  }}>
                    {currentTranscript.translatedText || 'Translating...'}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
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
      </div>

      {/* Status */}
      <div style={{ 
        textAlign: 'center', 
        marginTop: '1rem',
        color: '#666',
        fontSize: '0.9rem'
      }}>
        {isListening && (
          <div style={{ color: '#4ade80' }}>
            🎤 Teleprompter Active - Scrolling at 20px/sec ({transcriptionService === 'local' ? 'Local Faster-Whisper' : 'OpenAI Whisper'})
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