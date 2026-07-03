// =====================================================
// FRANÇAIS
// =====================================================

export function ImprintFR() {
  return (
    <div className="legal-text">
      <h3>Informations conformément au § 5 TMG (loi allemande sur les télémédias)</h3>
      <p>Roman Kuskowski<br />[Adresse à compléter]</p>
      <h3>Contact</h3>
      <p>Email : admin@masterselects.com</p>
      <h3>Responsable du contenu selon § 55 al. 2 RStV</h3>
      <p>Roman Kuskowski<br />[Adresse à compléter]</p>
      <h3>Règlement des litiges en ligne (UE)</h3>
      <p>
        La Commission européenne met à disposition une plateforme de règlement en ligne des litiges :{' '}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr/</a>
      </p>
      <h3>Droit d'auteur</h3>
      <p>
        MasterSelects est un logiciel open source, publié sur{' '}
        <a href="https://github.com/Sportinger/MasterSelects" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>
    </div>
  );
}

export function PrivacyFR() {
  return (
    <div className="legal-text">
      <h3>1. Protection des données en bref</h3>
      <p>
        <strong>MasterSelects est principalement une application locale.</strong> Tous les fichiers vidéo, image et audio
        sont traités exclusivement sur votre appareil. Vos fichiers média ne quittent jamais votre ordinateur.
      </p>
      <h3>2. Responsable du traitement</h3>
      <p>Roman Kuskowski<br />Email : admin@masterselects.com</p>
      <h3>3. Hébergement</h3>
      <p>
        Ce site est hébergé par <strong>Cloudflare, Inc.</strong> (USA), certifié EU-US Data Privacy Framework.
        Des clauses contractuelles types (CCT) sont également en place.
      </p>
      <p>
        En outre, nous traitons temporairement des &eacute;v&eacute;nements de visite c&ocirc;t&eacute; serveur pour la
        surveillance technique de l&apos;exploitation et pour des notifications internes en direct lorsqu&apos;une page
        de ce site est ouverte. Ces donn&eacute;es peuvent inclure le chemin demand&eacute;, l&apos;horodatage, le pays
        et la ville d&eacute;duits des donn&eacute;es g&eacute;ographiques de Cloudflare, le referer, un agent utilisateur
        raccourci ainsi qu&apos;un identifiant visiteur pseudonymis&eacute; g&eacute;n&eacute;r&eacute; &agrave; partir de
        l&apos;adresse IP et d&apos;un sel secret. Nous ne conservons pas l&apos;adresse IP en clair dans ce journal
        interne. La dur&eacute;e de conservation est g&eacute;n&eacute;ralement d&apos;environ une heure. Base juridique :
        art. 6(1)(f) RGPD (int&eacute;r&ecirc;t l&eacute;gitime &agrave; la s&eacute;curit&eacute; du service, &agrave; la
        d&eacute;tection des abus et &agrave; la connaissance de l&apos;activit&eacute; actuelle du site).
      </p>
      <h3>4. Comptes utilisateurs et paiements</h3>
      <p>Les paiements sont traités par <strong>Stripe, Inc.</strong> (certifié EU-US DPF). Nous ne stockons aucune donnée de carte bancaire.</p>
      <p>
        <strong>Journaux IA heberges :</strong> lorsque vous utilisez le chat IA heberge ou la generation media
        hebergee, les messages/prompts, payloads de requete, reponses, appels d&apos;outils, resultats de moderation,
        nombres de tokens, cout en credits, duree, statut, etat d&apos;erreur et un hash IP pseudonyme peuvent etre
        stockes dans notre base D1 pour l&apos;historique du compte, la facturation/le debogage, la lutte contre les
        abus et le support.
      </p>
      <h3>5. Vos droits (RGPD)</h3>
      <ul>
        <li>Accès (Art. 15), Rectification (Art. 16), Effacement (Art. 17)</li>
        <li>Limitation (Art. 18), Portabilité (Art. 20), Opposition (Art. 21)</li>
      </ul>
      <p>Contact : <strong>admin@masterselects.com</strong></p>
      <h3>6. Cookies</h3>
      <p>
        Uniquement des cookies techniques nécessaires. Pas de cookies de suivi ou marketing. La surveillance de visite
        décrite ci-dessus ne stocke pas d&apos;information sur votre terminal à cette fin.
      </p>
      <p className="legal-meta">Dernière mise à jour : mai 2026</p>
    </div>
  );
}

export function ContactFR() {
  return (
    <div className="legal-text">
      <h3>Contact</h3>
      <p>Pour toute question ou suggestion :</p>
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
      <h3>Demandes de confidentialité</h3>
      <p>Pour exercer vos droits RGPD : <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> avec l'objet "Demande de confidentialité".</p>
    </div>
  );
}
