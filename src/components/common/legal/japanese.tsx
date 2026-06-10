// =====================================================
// 日本語
// =====================================================

export function ImprintJA() {
  return (
    <div className="legal-text">
      <h3>運営者情報（ドイツ電気通信メディア法 § 5 TMG に基づく）</h3>
      <p>Roman Kuskowski<br />[住所は後日追記]</p>
      <h3>連絡先</h3>
      <p>メール: admin@masterselects.com</p>
      <h3>著作権</h3>
      <p>
        MasterSelects はオープンソースソフトウェアです。{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a> で公開されています。
      </p>
    </div>
  );
}

export function PrivacyJA() {
  return (
    <div className="legal-text">
      <h3>1. プライバシーの概要</h3>
      <p>
        <strong>MasterSelects は主にローカルアプリケーションです。</strong>すべてのビデオ、画像、音声ファイルはお使いのデバイス上でのみ処理されます。メディアファイルがコンピュータから外部に送信されることはありません。
      </p>
      <h3>2. データ管理者</h3>
      <p>Roman Kuskowski<br />メール: admin@masterselects.com</p>
      <h3>3. ホスティング</h3>
      <p><strong>Cloudflare, Inc.</strong>（米国）でホスティング。EU-US データプライバシーフレームワーク認定済み。</p>
      <p>
        さらに、本サイトのページが開かれた際、技術的な運用監視と内部向けライブ通知のために、サーバー側で訪問イベントを一時的に処理します。これには、リクエストされたパス、時刻、Cloudflare の地理データから得られる国と都市、リファラー、短縮された
        User-Agent、ならびに IP アドレスと秘密のソルトから生成される仮名化された訪問者 ID が含まれる場合があります。この内部ログに IP アドレスそのものは保存しません。保存期間は通常およそ 1 時間です。法的根拠は GDPR 第 6 条第 1 項
        f 号（安全な運用、不正利用の検知、現在のサイト活動の把握に関する正当な利益）です。
      </p>
      <h3>4. 決済</h3>
      <p><strong>Stripe, Inc.</strong> が決済を処理します。クレジットカード情報は保存しません。</p>
      <p>
        <strong>Hosted AI chat logs:</strong> when you use hosted AI chat, prompts/messages, responses, tool calls,
        token counts, credit cost, duration, status, and error state may be stored in our D1 database for account
        history, billing/debugging, abuse handling, and support.
      </p>
      <h3>5. あなたの権利（GDPR）</h3>
      <ul>
        <li>アクセス権（第15条）、訂正権（第16条）、消去権（第17条）</li>
        <li>制限権（第18条）、データポータビリティ（第20条）、異議申立権（第21条）</li>
      </ul>
      <p>連絡先: <strong>admin@masterselects.com</strong></p>
      <h3>6. Cookie</h3>
      <p>
        認証とセッション管理のための技術的に必要な Cookie のみを使用します。トラッキング Cookie やマーケティング Cookie は使用しません。上記の訪問監視は、この目的でお使いの端末に情報を保存しません。
      </p>
      <p className="legal-meta">最終更新: 2026年5月</p>
    </div>
  );
}

export function ContactJA() {
  return (
    <div className="legal-text">
      <h3>お問い合わせ</h3>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">メール</span>
          <a href="mailto:admin@masterselects.com">admin@masterselects.com</a>
        </div>
        <div className="legal-contact-row">
          <span className="legal-contact-label">GitHub</span>
          <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">Sportinger/MasterSelects</a>
        </div>
      </div>
    </div>
  );
}
