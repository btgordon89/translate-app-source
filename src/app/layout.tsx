import './globals.css'
import { AuthProvider } from '@/components/AuthProvider'

export const metadata = {
  title: 'Translate App',
  description: 'Translation service',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={{margin: 0, padding: 0, backgroundColor: 'white'}}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
