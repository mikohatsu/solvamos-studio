/**
 * Stitch: solvamos_studio_login_enhanced_content_1
 */
import type { ReactNode } from 'react';
import { Cloud, Wallet, Boxes } from 'lucide-react';

type Props = {
  onContinue: () => void;
  onDevSkip?: () => void;
  oauthConfigured?: boolean;
  busy?: boolean;
  error?: string | null;
};

export default function Landing({
  onContinue,
  onDevSkip,
  oauthConfigured,
  busy,
  error,
}: Props) {
  return (
    <div className="bg-[#0F172A] text-on-surface min-h-screen flex items-center justify-center font-sans relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/5 blur-[120px] pointer-events-none" />

      <div className="w-full min-h-screen flex flex-col md:flex-row relative z-10 max-w-[1920px] mx-auto">
        <div className="flex-1 flex flex-col justify-center p-8 md:p-16 relative max-w-2xl mx-auto w-full">
          <div className="flex items-center gap-4 mb-8">
            <img src="/logo.png" alt="SolVamos" className="h-16 w-16 object-contain" />
            <div className="flex flex-col items-start">
              <span className="text-5xl md:text-6xl font-bold text-primary tracking-tight leading-none">
                SolVamos
              </span>
              <span className="text-sm md:text-base text-on-surface tracking-[0.3em] uppercase mt-1 font-medium">
                Studio
              </span>
            </div>
          </div>

          <h1 className="text-3xl md:text-5xl font-bold text-on-surface mb-4 tracking-tight leading-tight">
            AI 에이전트로
            <br />
            비즈니스를 혁신하세요
          </h1>
          <p className="text-base md:text-lg text-on-surface-variant mb-8 leading-relaxed">
            코딩 없이 구축하고, 블록체인으로 수익화하는 차세대 엔터프라이즈 AI 플랫폼.
          </p>

          <div className="flex flex-col gap-4">
            <FeatureCard
              icon={<Boxes className="w-6 h-6 text-primary" />}
              title="No-Code AI 에이전트 빌더"
              body="복잡한 코딩 없이 직관적인 인터페이스로 맞춤형 AI 에이전트를 설계하고 배포하세요."
            />
            <FeatureCard
              icon={<Cloud className="w-6 h-6 text-google-blue" />}
              title="Google Cloud 기반 (엔터프라이즈 보안)"
              body="최고 수준의 클라우드 인프라를 통해 강력한 성능과 안전한 데이터 보호를 제공합니다."
            />
            <FeatureCard
              icon={<Wallet className="w-6 h-6 text-solana-green" />}
              title="Solana 연동 (온체인 수익화)"
              body="초고속 블록체인 네트워크를 통해 AI 서비스의 사용량 기반 실시간 결제 및 수익 모델을 구축하세요."
            />
          </div>
        </div>

        <div className="w-full md:w-[480px] lg:w-[560px] flex flex-col items-center justify-center p-8 md:p-16 bg-surface-container-lowest/80 backdrop-blur-xl border-t md:border-t-0 md:border-l border-white/10 shadow-2xl">
          <div className="w-full flex flex-col items-center text-center max-w-sm">
            <h2 className="text-2xl md:text-3xl font-semibold text-on-surface mb-2 tracking-tight">
              시작하기
            </h2>
            <p className="text-base text-on-surface-variant mb-10">
              Google 계정으로 로그인하면 Drive 폴더를 연결하고 워크스페이스에 입장합니다.
            </p>

            <button
              type="button"
              disabled={busy || oauthConfigured === false}
              onClick={onContinue}
              className="w-full flex items-center justify-center gap-4 py-4 px-6 rounded-full border border-outline-variant/40 bg-surface-container text-on-surface transition-all duration-300 hover:border-google-blue/50 hover:bg-surface-container-high group disabled:opacity-50 cursor-pointer"
            >
              <GoogleG />
              <span className="font-medium text-base md:text-lg group-hover:text-primary transition-colors">
                Google 계정으로 계속하기
              </span>
            </button>

            {error && (
              <p className="mt-4 text-xs text-red-400 leading-relaxed whitespace-pre-wrap">{error}</p>
            )}

            {oauthConfigured === false && (
              <p className="mt-4 text-xs text-outline leading-relaxed">
                OAuth Client가 `.env`에 없습니다. GCP에서 Web Client를 발급하고
                `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`을 넣은 뒤 서버를 재시작하세요.
                <br />
                안내: docs/DRIVE_OAUTH_SETUP.md
              </p>
            )}

            {oauthConfigured === false && onDevSkip && (
              <button
                type="button"
                disabled={busy}
                onClick={onDevSkip}
                className="mt-6 text-xs text-on-surface-variant underline hover:text-on-surface disabled:opacity-50"
              >
                개발 모드로 입장 (로그인 없이)
              </button>
            )}

            {oauthConfigured && (
              <p className="mt-4 text-xs text-solana-green/80 leading-relaxed">
                Google SSO 준비됨 · Drive.readonly 권한 포함
              </p>
            )}

            <p className="mt-8 text-[11px] text-outline leading-relaxed">
              계속 진행하면 서비스 이용약관 및 개인정보 처리방침에 동의하는 것으로 간주됩니다.
            </p>
            <p className="mt-4 text-[10px] text-outline font-medium">
              Powered by <span className="text-google-blue">Google Cloud</span> ×{' '}
              <span className="text-solana-green">Solana</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-lg bg-surface-container-low/50 border border-outline-variant/20 backdrop-blur-sm">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <h3 className="text-on-surface mb-1 text-lg font-semibold">{title}</h3>
        <p className="text-on-surface-variant text-sm leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
