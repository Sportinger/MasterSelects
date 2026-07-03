// =====================================================
// ESPAÑOL
// =====================================================

export function ImprintES() {
  return (
    <div className="legal-text">
      <h3>Información según § 5 TMG (Ley alemana de telemedios)</h3>
      <p>Roman Kuskowski<br />[Dirección pendiente]</p>
      <h3>Contacto</h3>
      <p>Email: admin@masterselects.com</p>
      <h3>Responsable del contenido según § 55 Abs. 2 RStV</h3>
      <p>Roman Kuskowski<br />[Dirección pendiente]</p>
      <h3>Resolución de disputas en línea (UE)</h3>
      <p>
        La Comisión Europea proporciona una plataforma para la resolución de disputas en línea:{' '}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr/</a>
      </p>
      <h3>Derechos de autor</h3>
      <p>
        MasterSelects es software de código abierto, publicado en{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>
    </div>
  );
}

export function PrivacyES() {
  return (
    <div className="legal-text">
      <h3>1. Privacidad en resumen</h3>
      <p>
        <strong>MasterSelects es principalmente una aplicación local.</strong> Todos los archivos se procesan
        exclusivamente en su dispositivo. Sus archivos multimedia nunca salen de su ordenador.
      </p>
      <h3>2. Responsable del tratamiento</h3>
      <p>Roman Kuskowski<br />Email: admin@masterselects.com</p>
      <h3>3. Alojamiento</h3>
      <p>Alojado por <strong>Cloudflare, Inc.</strong> (EE.UU.), certificado EU-US Data Privacy Framework. Se aplican cláusulas contractuales tipo (CCT).</p>
      <p>
        Adem&aacute;s, procesamos temporalmente eventos de visita en el servidor para la supervisi&oacute;n t&eacute;cnica
        del servicio y para notificaciones internas en tiempo real cuando se abre una p&aacute;gina de este sitio web.
        Estos eventos pueden incluir la ruta solicitada, la marca temporal, el pa&iacute;s y la ciudad derivados de los
        datos geogr&aacute;ficos de Cloudflare, el referer, una cadena abreviada del agente de usuario y un identificador
        seudonimizado del visitante generado a partir de la direcci&oacute;n IP y un valor secreto. No almacenamos la IP
        en texto claro en este registro interno. El plazo de conservaci&oacute;n suele ser de aproximadamente una hora.
        Base jur&iacute;dica: art. 6(1)(f) RGPD (inter&eacute;s leg&iacute;timo en el funcionamiento seguro, la detecci&oacute;n
        de abusos y el conocimiento de la actividad actual del sitio).
      </p>
      <h3>4. Cuentas y pagos</h3>
      <p>Los pagos son procesados por <strong>Stripe, Inc.</strong> (certificado EU-US DPF). No almacenamos datos de tarjetas.</p>
      <p>
        <strong>Registros de IA alojada:</strong> cuando utiliza el chat de IA alojado o la generacion multimedia
        alojada, los mensajes/prompts, payloads de solicitud, respuestas, llamadas a herramientas, resultados de
        moderacion, recuentos de tokens, coste en creditos, duracion, estado, errores y un hash IP seudonimo pueden
        almacenarse en nuestra base D1 para historial de cuenta, facturacion/depuracion, prevencion de abuso y soporte.
      </p>
      <h3>5. Sus derechos (RGPD)</h3>
      <ul>
        <li>Acceso (Art. 15), Rectificación (Art. 16), Supresión (Art. 17)</li>
        <li>Limitación (Art. 18), Portabilidad (Art. 20), Oposición (Art. 21)</li>
      </ul>
      <p>Contacto: <strong>admin@masterselects.com</strong></p>
      <h3>6. Cookies</h3>
      <p>
        Solo cookies técnicamente necesarias. Sin cookies de seguimiento o marketing. La supervisión de visitas
        descrita arriba no almacena información en su dispositivo con esta finalidad.
      </p>
      <p className="legal-meta">Última actualización: mayo 2026</p>
    </div>
  );
}

export function ContactES() {
  return (
    <div className="legal-text">
      <h3>Contacto</h3>
      <p>Para preguntas o sugerencias:</p>
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
      <h3>Solicitudes de privacidad</h3>
      <p>Para ejercer sus derechos RGPD: <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> con asunto "Solicitud de privacidad".</p>
    </div>
  );
}
