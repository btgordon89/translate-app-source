'use client';

import { useState } from 'react';

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === 'ben' && password === 'gordon') {
      setIsAuthenticated(true);
      setError('');
    } else {
      setError('Invalid credentials');
    }
  };

  if (!isAuthenticated) {
    return (
      <div style={{ 
        display: 'flex', 
        height: '100vh', 
        alignItems: 'center', 
        justifyContent: 'center', 
        backgroundColor: 'white',
        fontFamily: 'Arial, sans-serif'
      }}>
        <div style={{ 
          padding: '2rem', 
          border: '1px solid #ccc', 
          borderRadius: '8px',
          backgroundColor: 'white',
          minWidth: '300px'
        }}>
          <h2 style={{ color: 'black', marginBottom: '1rem', textAlign: 'center' }}>Login to Translate</h2>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'black' }}>
                Username:
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '0.5rem', 
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  color: 'black'
                }}
                required
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', color: 'black' }}>
                Password:
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ 
                  width: '100%', 
                  padding: '0.5rem', 
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  color: 'black'
                }}
                required
              />
            </div>
            {error && (
              <div style={{ color: 'red', marginBottom: '1rem', fontSize: '0.875rem' }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              style={{ 
                width: '100%', 
                padding: '0.75rem', 
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      backgroundColor: 'white', 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      alignItems: 'center', 
      justifyContent: 'center',
      gap: '2rem'
    }}>
      <h1 style={{ color: 'black', fontSize: '2rem', fontFamily: 'Arial, sans-serif' }}>
        translate
      </h1>
      <button
        onClick={() => window.location.href = '/transcribe'}
        style={{
          padding: '1rem 2rem',
          fontSize: '1.1rem',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer'
        }}
      >
        Start Transcription
      </button>
    </div>
  );
}
