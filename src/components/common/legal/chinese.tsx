// =====================================================
// 中文
// =====================================================

export function ImprintZH() {
  return (
    <div className="legal-text">
      <h3>运营者信息（根据德国电信媒体法 § 5 TMG）</h3>
      <p>Roman Kuskowski<br />[地址待补充]</p>
      <h3>联系方式</h3>
      <p>电子邮件: admin@masterselects.com</p>
      <h3>版权</h3>
      <p>
        MasterSelects 是开源软件，发布在{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a>。
      </p>
    </div>
  );
}

export function PrivacyZH() {
  return (
    <div className="legal-text">
      <h3>1. 隐私概览</h3>
      <p>
        <strong>MasterSelects 主要是一个本地应用程序。</strong>所有视频、图片和音频文件仅在您的设备上处理。您的媒体文件永远不会离开您的计算机。
      </p>
      <h3>2. 数据控制者</h3>
      <p>Roman Kuskowski<br />电子邮件: admin@masterselects.com</p>
      <h3>3. 托管</h3>
      <p>由 <strong>Cloudflare, Inc.</strong>（美国）托管，已获 EU-US 数据隐私框架认证。</p>
      <p>
        此外，当您打开本网站页面时，我们会临时在服务器端处理访问事件，用于技术运行监控和内部实时提醒。这些事件可能包括访问路径、时间戳、基于 Cloudflare 地理数据得出的国家和城市、referer、缩短后的 user agent，以及基于 IP 地址和秘密盐值
        生成的匿名化访客标识。我们不会在该内部日志中保存明文 IP 地址。此类访问事件通常仅保存约一小时。法律依据为 GDPR 第 6 条第 1 款 (f) 项，即我们对安全运行、滥用检测以及了解当前网站活动所具有的正当利益。
      </p>
      <h3>4. 支付</h3>
      <p>由 <strong>Stripe, Inc.</strong> 处理支付。我们不存储信用卡信息。</p>
      <p>
        <strong>Hosted AI logs:</strong> when you use hosted AI chat or hosted media generation, prompts/messages,
        request payloads, responses, tool calls, moderation results, token counts, credit cost, duration, status,
        error state, and a pseudonymous IP hash may be stored in our D1 database for account history,
        billing/debugging, abuse handling, and support.
      </p>
      <h3>5. 您的权利（GDPR）</h3>
      <ul>
        <li>访问权（第15条）、更正权（第16条）、删除权（第17条）</li>
        <li>限制处理权（第18条）、数据可携权（第20条）、反对权（第21条）</li>
      </ul>
      <p>联系方式: <strong>admin@masterselects.com</strong></p>
      <h3>6. Cookie</h3>
      <p>
        我们仅使用身份验证和会话管理所必需的技术性 Cookie，不使用跟踪或营销 Cookie。上述访问监控不会为此目的在您的设备上存储信息。
      </p>
      <p className="legal-meta">最后更新: 2026年5月</p>
    </div>
  );
}

export function ContactZH() {
  return (
    <div className="legal-text">
      <h3>联系方式</h3>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">电子邮件</span>
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
