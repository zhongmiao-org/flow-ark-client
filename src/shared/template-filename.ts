/** Both export entry points use the importer's ZIP format and canonical default name. */
export function templateFilename(id: string, version: string) {
  return `${id}-${version}.flowark-template.zip`;
}
export function zipExportPath(path: string) {
  return /\.zip$/i.test(path) ? path : path + '.zip';
}
