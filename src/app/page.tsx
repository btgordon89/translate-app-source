'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import Login from '@/components/auth/Login';

export default function Home() {
  const { data: session, status } = useSession();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status !== 'loading') {
      setIsLoading(false);
    }
  }, [status]);

  if (isLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        height: '100vh', 
        alignItems: 'center', 
        justifyContent: 'center', 
        backgroundColor: 'white' 
      }}>
        <div style={{ color: 'black' }}>Loading...</div>
      </div>
    );
  }

  if (!session) {
    return <Login onLogin={() => window.location.reload()} />;
  }

  return (
    <div style={{ 
      backgroundColor: 'white', 
      height: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center' 
    }}>
      <h1 style={{ color: 'black', fontSize: '2rem', fontFamily: 'Arial, sans-serif' }}>
        translate
      </h1>
    </div>
  );
}
