/**
 * Licence clause text, version-controlled here rather than in the database so a
 * change to the terms is a reviewable diff. The database stores which version
 * each licence was issued under, so amending this file never alters a licence
 * that has already been executed.
 *
 * ---------------------------------------------------------------------------
 * NOT LEGAL ADVICE. This is a working draft that encodes the product's intent:
 * one painting, one buyer, no reproduction, copyright retained, traceable file.
 * Have an IP attorney draft the production template before launch. The licence
 * IS the product - it is the thing being sold, and everything else in this
 * codebase is plumbing around it.
 * ---------------------------------------------------------------------------
 *
 * Why a licence at all: a painting made from someone else's photograph is a
 * derivative work. Since Warhol Foundation v. Goldsmith (2023), fair use for
 * commercial derivative art is narrower than most painters assume, and a painter
 * working from a found photo generally has unclear rights and does not know it.
 * The product is certainty - a pre-cleared grant attached to the image before a
 * brush is loaded.
 */

const SINGLE_USE_V1 = {
  tier: 'single_use',
  version: '2026.1',
  title: 'Single-Use Painting Licence',
  preamble:
    'This Licence is made between the Photographer, the Painter and the Buyer identified in ' +
    'Schedule A, and takes effect on the date the last of them signs it. It is issued through ' +
    'the Platform in connection with the Commission identified in Schedule A, and grants the ' +
    'Painter the right to make one painting - and only one - from the Photographer\'s image.',
  clauses: [
    ['Definitions',
      '"Image" means the photograph identified in Schedule A, in the resolution delivered to the ' +
      'Painter through the Platform. "Painting" means the single original artwork the Painter creates ' +
      'from the Image under this Licence. "Commission" means the transaction identified in Schedule A ' +
      'under which the Buyer has paid for the Painting. "Platform" means the operator of the registry ' +
      'and escrow service through which this Licence was issued.'],

    ['Grant',
      'The Photographer grants the Painter a non-exclusive, non-transferable, non-sublicensable right ' +
      'to reproduce, adapt and translate the Image into one Painting, in the medium and at approximately ' +
      'the dimensions stated in Schedule A, for delivery to the Buyer under the Commission. This right is ' +
      'exhausted on completion of that one Painting. It does not permit a second painting, a study offered ' +
      'for sale, a variant, an edition, or a copy in another medium.'],

    ['Reservation of rights',
      'The Photographer retains all copyright and all other rights in the Image. Nothing in this Licence ' +
      'transfers ownership of the Image or of any copyright in it. Any right not expressly granted here is ' +
      'reserved to the Photographer.'],

    ['Restrictions on the Image file',
      'The Painter may use the delivered file only as working reference for the Painting. The Painter may ' +
      'not print it other than as a working reference for their own studio use, publish it, post it, sell it, ' +
      'redistribute it, license it onward, use it to train a machine learning model, or provide it to any ' +
      'third party. The Painter must not remove or alter any identifier embedded in the file. On completion ' +
      'of the Painting the Painter must delete working copies other than one archival copy retained solely ' +
      'as a record of the commission.'],

    ['Rights in the Painting',
      'The Painting is the Painter\'s own work of authorship and the Painter owns the copyright in it, ' +
      'subject to the Photographer\'s underlying rights in the Image. The Painter may photograph the ' +
      'Painting and show it in a portfolio, on social media and in exhibition submissions, with the credit ' +
      'required by clause 7. The Painter may not make or sell reproductions, prints, editions or merchandise ' +
      'of the Painting unless a reproduction licence for the Image has separately been issued.'],

    ['The Buyer\'s rights',
      'On settlement of the Commission the Buyer owns the physical Painting and may display it, lend it, ' +
      'insure it and resell it. The Buyer receives no copyright in either the Painting or the Image, and may ' +
      'not make or authorise reproductions for commercial purposes. The Buyer may photograph the Painting ' +
      'for personal, insurance and resale-listing purposes.'],

    ['Credit',
      'Wherever the Painting is reproduced or exhibited by the Painter or the Buyer, it must be credited in ' +
      'substantially this form: "after a photograph by [Photographer], licensed". Failure to credit is a ' +
      'breach of this Licence but does not by itself terminate the grant.'],

    ['Term and termination',
      'This Licence takes effect on execution and continues for the life of the Painting, save that the right ' +
      'to make the Painting expires if the Painting is not completed within the period stated in Schedule A. ' +
      'The Photographer may terminate the grant on written notice if the Painter materially breaches clause 4 ' +
      'or clause 5 and does not cure the breach within fourteen days. Termination does not affect the Buyer\'s ' +
      'ownership of a Painting already delivered.'],

    ['Traceability',
      'The file delivered to the Painter carries an identifier unique to this Licence and to each download. ' +
      'The Painter consents to that identifier being embedded and to its use to establish the source of any ' +
      'copy of the Image found outside the terms of this Licence. The Platform does not deliver RAW files ' +
      'under any tier.'],

    ['Photographer\'s warranties',
      'The Photographer warrants that they are the sole owner of the copyright in the Image, that they have ' +
      'the right to grant this Licence, and that to the best of their knowledge the Image does not infringe ' +
      'any third party right. Where the Image shows an identifiable person or private property, the ' +
      'Photographer warrants that they hold any release stated in Schedule A, and the Painter and the Buyer ' +
      'rely on that statement.'],

    ['Indemnity and limitation',
      'The Photographer will indemnify the Painter and the Buyer against any claim that the Image infringes ' +
      'a third party copyright, to the extent of the amounts paid under the Commission. No party is liable ' +
      'to another for indirect or consequential loss. Nothing in this clause limits liability for fraud.'],

    ['Payment',
      'The Buyer pays the Commission price to the Platform, which holds it and releases it on the Buyer\'s ' +
      'confirmation of delivery, splitting it between the Painter, the Photographer and the Platform in the ' +
      'proportions stated in Schedule A. The Painter does not invoice the Photographer and the Photographer ' +
      'does not invoice anyone. The Platform is responsible for the resulting information returns.'],

    ['Registry',
      'On completion the Platform records a signed registry entry naming both creators, this Licence and the ' +
      'provenance of the Painting. Each party consents to that entry being published and to it being checkable ' +
      'by anyone holding its certificate number. The entry is a record of provenance. It is not a security, ' +
      'an investment instrument, or a claim on any future sale of the Painting.'],

    ['Electronic signature',
      'Each party signs by typing their name in the Platform and confirming. The parties agree that this ' +
      'constitutes an electronic signature under the E-SIGN Act and applicable state law, that the Licence may ' +
      'be executed in counterparts, and that the record of signature retained by the Platform - name, ' +
      'timestamp and the hash of the terms signed - is admissible evidence of execution.'],

    ['Governing law',
      'This Licence is governed by the law of the State stated in Schedule A, without regard to its conflict ' +
      'of laws rules. The parties will attempt in good faith to resolve any dispute through the Platform\'s ' +
      'dispute process before commencing proceedings.'],

    ['Entire agreement',
      'This Licence and Schedule A are the entire agreement between the parties about the Image and the ' +
      'Painting, and supersede any prior discussion. It may be amended only in a writing signed by all three ' +
      'parties. If any clause is unenforceable the rest stands.'],
  ],
};

const TEMPLATES = { single_use: SINGLE_USE_V1 };

function templateFor(tier) {
  const template = TEMPLATES[tier];
  if (!template) throw new Error(`No licence template for tier "${tier}"`);
  return template;
}

module.exports = { TEMPLATES, templateFor, SINGLE_USE_V1 };
