/** THE FAN CONTENT NOTICE, AND THE DATA CREDITS.
 *
 *  This app shows Wizards' intellectual property — card names, oracle text, card art and the mana
 *  symbols — which the Fan Content Policy permits for a free, non-commercial fan site and which the
 *  policy also requires be labelled as unofficial. The first paragraph is Wizards' own required
 *  wording; the second is the plain-language version of the same claim, in the shape every
 *  comparable deckbuilder states it.
 *
 *  THE CREDITS NAME ONLY WHAT THIS APP ACTUALLY USES. Scryfall supplies the card data, the art
 *  crops and the mana symbol SVGs; Commander Spellbook supplies the combos. There is deliberately
 *  no price disclaimer of the kind those sites carry — this app shows no prices at all, "cost" here
 *  is a mana cost, and a disclaimer about data we do not display would be noise pretending to be
 *  diligence.
 *
 *  DESIGN.md's own note applies: if EDH Seer ever takes money, this is one of the things that has
 *  to be revisited, because the Fan Content Policy stops covering it. */
export function Footer() {
  return (
    <footer className="mt-8 border-t border-(--separator) pt-6 flex flex-col gap-3 text-xs text-(--muted)">
      <p className="max-w-[75ch]">
        EDH Seer is unofficial Fan Content permitted under the{" "}
        <FooterLink href="https://company.wizards.com/en/legal/fancontentpolicy">
          Wizards of the Coast Fan Content Policy
        </FooterLink>
        . Not approved or endorsed by Wizards. Portions of the materials used are property of
        Wizards of the Coast. ©Wizards of the Coast LLC.
      </p>
      <p className="max-w-[75ch]">
        Wizards of the Coast, Magic: The Gathering, and their logos are trademarks of Wizards of the
        Coast LLC in the United States and other countries. © 1993–2026 Wizards. All Rights
        Reserved. EDH Seer is not affiliated with, endorsed, sponsored, or specifically approved by
        Wizards of the Coast LLC. For more information about Wizards of the Coast or any of
        Wizards&apos; trademarks or other intellectual property, please visit{" "}
        <FooterLink href="https://company.wizards.com/">company.wizards.com</FooterLink>.
      </p>
      <p className="max-w-[75ch]">
        Card data, card images and mana symbols are provided by{" "}
        <FooterLink href="https://scryfall.com/">Scryfall</FooterLink>, which is unaffiliated with
        this site. Combo data is provided by{" "}
        <FooterLink href="https://commanderspellbook.com/">Commander Spellbook</FooterLink>. This
        site shows no card prices.
      </p>
    </footer>
  );
}

/** `rel="noreferrer"` alongside `noopener`: these are outbound links to third parties named in a
 *  legal notice, and there is no reason to tell them which page the reader came from. */
function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-(--accent) underline underline-offset-2">
      {children}
    </a>
  );
}
