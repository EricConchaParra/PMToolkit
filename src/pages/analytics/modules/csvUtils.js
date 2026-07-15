/**
 * PMsToolKit — Analytics Hub
 * Shared CSV helpers used across export-capable tools
 */

export function escapeCSV(v) {
    const str = String(v ?? '').replace(/"/g, '""');
    return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${str}"` : str;
}

export function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
