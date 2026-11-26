/**
 * Turns the server's warning codes into short messages for the result banner.
 * Unknown codes are ignored (the server may add new ones before the app knows them).
 */
export function describeWarnings(codes: string[]): string[] {
  const out: string[] = [];
  for (const code of codes) {
    if (code === 'not_an_expense') out.push("This didn't sound like a purchase. Check it before saving.");
    else if (code.startsWith('other_currency:')) {
      const cur = code.slice('other_currency:'.length) || 'another currency';
      out.push(`You mentioned ${cur}. SplitNote records US dollars, so convert the amount before saving.`);
    } else if (code === 'amount_out_of_range') out.push('The amount looked wrong, so it was left empty.');
    else if (code === 'tax_dropped') out.push("The tax wasn't less than the amount, so it was left empty.");
    else if (code === 'custom_split_dropped') out.push("The per-person amounts didn't add up, so it's split equally.");
    else if (code === 'totals_do_not_add_up') out.push("The receipt's totals don't add up. Check the amount and tax.");
    else if (code === 'not_a_receipt') out.push("That doesn't look like a receipt. Check the details.");
  }
  return out;
}
