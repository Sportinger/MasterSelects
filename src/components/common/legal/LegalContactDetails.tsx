interface LegalContactMethodsProps {
  emailLabel: string;
  phoneLabel: string;
}

export function LegalPostalAddress() {
  return (
    <>
      Jan Roman Kuskowski<br />
      c/o POSTFLEX PFX-743-374<br />
      Emsdettener Straße 10<br />
      48268 Greven
    </>
  );
}

export function LegalContactMethods({ emailLabel, phoneLabel }: LegalContactMethodsProps) {
  return (
    <>
      {emailLabel}: admin@masterselects.com<br />
      {phoneLabel}: 0151 51484895
    </>
  );
}
