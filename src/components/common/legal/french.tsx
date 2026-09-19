import { LegalContactMethods, LegalPostalAddress } from './LegalContactDetails';

// =====================================================
// FRANÇAIS
// =====================================================

export function ImprintFR() {
  return (
    <div className="legal-text">
      <h3>Informations conformément au § 5 TMG (loi allemande sur les télémédias)</h3>
      <p><LegalPostalAddress /></p>
      <h3>Contact</h3>
      <p><LegalContactMethods emailLabel="Email" phoneLabel="Téléphone" /></p>
      <h3>Responsable du contenu selon § 55 al. 2 RStV</h3>
      <p><LegalPostalAddress /></p>
      <h3>Règlement des litiges en ligne (UE)</h3>
      <p>
        La Commission européenne met à disposition une plateforme de règlement en ligne des litiges :{' '}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr/</a>
      </p>
      <h3>Droit d'auteur</h3>
      <p>
        L'éditeur MasterSelects est sous licence GNU AGPL-3.0-only. Copyright © 2026 Jan Roman Kuskowski.
        Les composants tiers restent soumis à leurs licences respectives.
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
      <p><LegalPostalAddress /><br /><LegalContactMethods emailLabel="Email" phoneLabel="Téléphone" /></p>
      <h3>3. Hébergement</h3>
      <p>
        Ce site est hébergé par <strong>Cloudflare, Inc.</strong> (USA), certifié EU-US Data Privacy Framework.
        Des clauses contractuelles types (CCT) sont également en place.
      </p>
      <p>
        En outre, nous traitons temporairement des &eacute;v&eacute;nements de visite c&ocirc;t&eacute; serveur pour la
        surveillance technique de l&apos;exploitation et pour des notifications internes en direct lorsqu&apos;une page
        de ce site est ouverte. Ces donn&eacute;es peuvent inclure le chemin demand&eacute;, l&apos;horodatage, le pays
        d&eacute;duit des donn&eacute;es g&eacute;ographiques de Cloudflare, des cat&eacute;gories g&eacute;n&eacute;rales de navigateur,
        syst&egrave;me d&apos;exploitation et appareil, le domaine du referer, ainsi qu&apos;un identifiant visiteur
        pseudonymis&eacute; renouvel&eacute; chaque jour et produit par HMAC &agrave; partir de l&apos;adresse IP et d&apos;une cl&eacute;
        secr&egrave;te. La ville, l&apos;agent utilisateur complet, l&apos;URL compl&egrave;te du referer et l&apos;adresse IP en clair
        ne sont pas conserv&eacute;s; l&apos;identifiant ne permet pas de relier les visites entre diff&eacute;rents jours. Les
        &eacute;v&eacute;nements sont automatiquement supprim&eacute;s apr&egrave;s 180 jours. Base juridique :
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
      <p>
        <strong>Analyse produit :</strong> nous traitons une liste fixe d&apos;événements généraux (ouverture,
        tutoriel, importation, catégories de montage, lecture, paiement et exportation). Les événements connectés
        peuvent être liés à l&apos;identifiant interne du compte; les événements anonymes utilisent uniquement un
        identifiant de session temporaire en mémoire. Aucun nom de fichier, contenu de projet ou média, prompt, texte
        de chat/transcription, erreur brute, cookie analytique ou identifiant permanent d&apos;appareil n&apos;est collecté.
        Les événements sont supprimés après 180 jours. Vous pouvez vous y opposer dans Paramètres &gt; Général &gt;
        Confidentialité; Do Not Track et Global Privacy Control sont respectés.
      </p>
      <p className="legal-meta">Dernière mise à jour : 16 août 2026</p>
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
      </div>
      <h3>Demandes de confidentialité</h3>
      <p>Pour exercer vos droits RGPD : <a href="mailto:admin@masterselects.com">admin@masterselects.com</a> avec l'objet "Demande de confidentialité".</p>
    </div>
  );
}
