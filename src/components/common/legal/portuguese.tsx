// =====================================================
// PORTUGUÊS
// =====================================================

export function ImprintPT() {
  return (
    <div className="legal-text">
      <h3>Informações conforme § 5 TMG (Lei alemã de telemídia)</h3>
      <p>Roman Kuskowski<br />[Endereço a ser adicionado]</p>
      <h3>Contato</h3>
      <p>Email: admin@masterselects.com</p>
      <h3>Direitos autorais</h3>
      <p>
        MasterSelects é software de código aberto, publicado no{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>
    </div>
  );
}

export function PrivacyPT() {
  return (
    <div className="legal-text">
      <h3>1. Privacidade em resumo</h3>
      <p>
        <strong>MasterSelects é principalmente um aplicativo local.</strong> Todos os arquivos são processados
        exclusivamente no seu dispositivo. Seus arquivos de mídia nunca saem do seu computador.
      </p>
      <h3>2. Controlador de dados</h3>
      <p>Roman Kuskowski<br />Email: admin@masterselects.com</p>
      <h3>3. Hospedagem</h3>
      <p>Hospedado pela <strong>Cloudflare, Inc.</strong> (EUA), certificada pelo EU-US Data Privacy Framework.</p>
      <p>
        Al&eacute;m disso, processamos temporariamente eventos de visita no servidor para monitoramento t&eacute;cnico
        da opera&ccedil;&atilde;o e para notifica&ccedil;&otilde;es internas em tempo real quando uma p&aacute;gina deste
        site &eacute; aberta. Esses eventos podem incluir o caminho solicitado, o hor&aacute;rio, pa&iacute;s e cidade
        derivados dos dados geogr&aacute;ficos da Cloudflare, referer, um user agent abreviado e um identificador
        pseudonimizado do visitante gerado a partir do endere&ccedil;o IP e de um valor secreto. N&atilde;o armazenamos o
        IP em texto puro nesse log interno. O prazo de reten&ccedil;&atilde;o normalmente &eacute; de cerca de uma hora.
        Base legal: art. 6(1)(f) do RGPD (interesse leg&iacute;timo na opera&ccedil;&atilde;o segura, detec&ccedil;&atilde;o
        de abuso e conhecimento da atividade atual do site).
      </p>
      <h3>4. Pagamentos</h3>
      <p>Processados pelo <strong>Stripe, Inc.</strong> (certificado EU-US DPF). Não armazenamos dados de cartão.</p>
      <p>
        <strong>Logs de IA hospedada:</strong> quando voce usa o chat de IA hospedado ou a geracao de midia
        hospedada, mensagens/prompts, payloads de requisicao, respostas, chamadas de ferramentas, resultados de
        moderacao, contagens de tokens, custo em creditos, duracao, status, estado de erro e um hash de IP pseudonimo
        podem ser armazenados no nosso banco D1 para historico da conta, cobranca/debug, prevencao de abuso e suporte.
      </p>
      <h3>5. Seus direitos (RGPD)</h3>
      <ul>
        <li>Acesso (Art. 15), Retificação (Art. 16), Eliminação (Art. 17)</li>
        <li>Limitação (Art. 18), Portabilidade (Art. 20), Oposição (Art. 21)</li>
      </ul>
      <p>Contato: <strong>admin@masterselects.com</strong></p>
      <h3>6. Cookies</h3>
      <p>
        Apenas cookies tecnicamente necessários. Nenhum cookie de rastreamento ou marketing. O monitoramento de
        visitas descrito acima não armazena informações no seu dispositivo para essa finalidade.
      </p>
      <p className="legal-meta">Última atualização: maio 2026</p>
    </div>
  );
}

export function ContactPT() {
  return (
    <div className="legal-text">
      <h3>Contato</h3>
      <div className="legal-contact-card">
        <div className="legal-contact-row">
          <span className="legal-contact-label">Email</span>
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
