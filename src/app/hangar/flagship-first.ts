/**
 * The flagship leads every ship list (concept "Gegenstand weg", `r2-flag = top`): the list is
 * stable otherwise, so a reader finds the same order everywhere. The mark is the word
 * "Flaggschiff" (`hangar.flagship.mark`), no icon.
 */
export function flagshipFirst<T extends { shipClassName: string }>(
  ships: readonly T[],
  isFlagship: (shipClassName: string) => boolean,
): T[] {
  const lead = ships.filter((s) => isFlagship(s.shipClassName));
  return lead.length === 0 ? [...ships] : [...lead, ...ships.filter((s) => !isFlagship(s.shipClassName))];
}
