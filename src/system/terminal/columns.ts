/**
 * Pad labels to one column, so a block of label and value lines lines up.
 * @param rows - each line's label and value
 * @param indent - text before each label
 * @returns the lines
 */
export function aligned(rows: [string, string][], indent: string): string[] {
    const width = Math.max(...rows.map(([label]) => label.length))

    return rows.map(([label, value]) => `${indent}${label.padEnd(width)}  ${value}`)
}
