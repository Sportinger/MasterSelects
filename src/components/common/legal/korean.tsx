import { LegalContactMethods, LegalPostalAddress } from './LegalContactDetails';

// =====================================================
// 한국어
// =====================================================

export function ImprintKO() {
  return (
    <div className="legal-text">
      <h3>운영자 정보 (독일 텔레미디어법 § 5 TMG)</h3>
      <p><LegalPostalAddress /></p>
      <h3>연락처</h3>
      <p><LegalContactMethods emailLabel="이메일" phoneLabel="전화" /></p>
      <h3>저작권</h3>
      <p>
        MasterSelects 편집기는 GNU AGPL-3.0-only 라이선스로 제공됩니다. Copyright © 2026 Jan Roman Kuskowski.
        타사 구성 요소에는 각각의 라이선스가 적용됩니다.
      </p>
    </div>
  );
}

export function PrivacyKO() {
  return (
    <div className="legal-text">
      <h3>1. 개인정보 처리 개요</h3>
      <p>
        <strong>MasterSelects는 주로 로컬 애플리케이션입니다.</strong> 모든 비디오, 이미지, 오디오 파일은 사용자의 기기에서만 처리됩니다. 미디어 파일은 절대 컴퓨터 밖으로 전송되지 않습니다.
      </p>
      <h3>2. 데이터 관리자</h3>
      <p><LegalPostalAddress /><br /><LegalContactMethods emailLabel="이메일" phoneLabel="전화" /></p>
      <h3>3. 호스팅</h3>
      <p><strong>Cloudflare, Inc.</strong>(미국)에서 호스팅. EU-US 데이터 프라이버시 프레임워크 인증.</p>
      <p>
        또한 이 사이트의 페이지가 열릴 때 기술 운영 모니터링과 내부 실시간 알림을 위해 서버 측 방문 이벤트를 처리합니다. 여기에는 요청된 경로, 시각, Cloudflare 지리 데이터에서 도출된 국가, 대략적인 브라우저·운영체제·기기 범주, referer 도메인, 그리고 IP 주소를 비밀 키 HMAC으로 처리해 매일 바뀌는 가명화된 방문자 ID가 포함될 수 있습니다. 도시, 전체 user agent, 전체 referer URL 및 원본 IP 주소는 저장하지 않으며 이 ID로 날짜가 다른 방문을 연결할 수 없습니다. 방문 이벤트는 180일 후 자동 삭제됩니다. 법적 근거는 GDPR 제6조 제1항 (f)호, 즉 안전한 운영, 남용 탐지 및 사이트 활동 파악에
        대한 정당한 이익입니다.
      </p>
      <h3>4. 결제</h3>
      <p><strong>Stripe, Inc.</strong>가 결제를 처리합니다. 신용카드 정보는 저장하지 않습니다.</p>
      <p>
        <strong>Hosted AI logs:</strong> when you use hosted AI chat or hosted media generation, prompts/messages,
        request payloads, responses, tool calls, moderation results, token counts, credit cost, duration, status,
        error state, and a pseudonymous IP hash may be stored in our D1 database for account history,
        billing/debugging, abuse handling, and support.
      </p>
      <h3>5. 귀하의 권리 (GDPR)</h3>
      <ul>
        <li>열람권 (제15조), 정정권 (제16조), 삭제권 (제17조)</li>
        <li>처리제한권 (제18조), 이동권 (제20조), 반대권 (제21조)</li>
      </ul>
      <p>연락처: <strong>admin@masterselects.com</strong></p>
      <h3>6. 쿠키</h3>
      <p>
        인증과 세션 관리를 위한 기술적으로 필요한 쿠키만 사용합니다. 추적 또는 마케팅 쿠키는 사용하지 않습니다. 위에서 설명한 방문 모니터링은 이 목적을 위해 사용자 단말기에 정보를 저장하지 않습니다.
      </p>
      <p className="legal-meta">최종 업데이트: 2026년 5월</p>
    </div>
  );
}

export function ContactKO() {
  return (
    <div className="legal-text">
      <h3>연락처</h3>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">이메일</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
      </div>
    </div>
  );
}
