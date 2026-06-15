import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cover bg-center" style={{ backgroundImage: "url('/bg.jpg')" }}>
      <div className="absolute inset-0 bg-[#080B14] opacity-80"></div>
      <div className="z-10 animate-fade-in-up">
        <SignUp fallbackRedirectUrl="/onboard/language" signInUrl="/sign-in" />
      </div>
    </div>
  );
}
