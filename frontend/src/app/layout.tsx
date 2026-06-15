import { ClerkProvider } from '@clerk/nextjs'
import { Inter } from 'next/font/google'
import './globals.css'
import SessionTimeout from '@/components/SessionTimeout'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Aria - AI KYC Onboarding',
  description: 'AI-powered video call loan onboarding platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider
      appearance={{
        variables: { colorPrimary: '#3B82F6', colorBackground: '#080B14', colorText: '#F1F5F9', colorInputBackground: '#0D1120', colorInputText: '#F1F5F9' },
        elements: {
          card: 'bg-opacity-50 backdrop-blur-md border border-white/10',
          headerTitle: 'text-2xl font-bold',
        }
      }}
    >
      <html lang="en">
        <body className={`${inter.className} bg-[#080B14] text-[#F1F5F9] antialiased min-h-screen flex flex-col`}>
          <SessionTimeout>
            {children}
          </SessionTimeout>
        </body>
      </html>
    </ClerkProvider>
  )
}
