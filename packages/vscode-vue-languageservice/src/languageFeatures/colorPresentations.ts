import {
	TextDocument,
	ColorPresentation,
	Color,
	Range,
	TextEdit,
} from 'vscode-languageserver';
import { SourceFile } from '../sourceFiles';

export function register(sourceFiles: Map<string, SourceFile>) {
	return (document: TextDocument, color: Color, range: Range) => {
		const sourceFile = sourceFiles.get(document.uri);
		if (!sourceFile) return;

		const cssResult = getCssResult(sourceFile);
		return cssResult;

		function getCssResult(sourceFile: SourceFile) {
			let result: ColorPresentation[] = [];
			for (const sourceMap of sourceFile.getCssSourceMaps()) {
				const virtualLocs = sourceMap.findTargets(range);
				for (const virtualLoc of virtualLocs) {
					const ls = sourceMap.languageService;
					const _result = ls.getColorPresentations(sourceMap.targetDocument, sourceMap.stylesheet, color, virtualLoc.range);
					for (const item of _result) {
						if (item.textEdit) {
							if (TextEdit.is(item.textEdit)) {
								const vueLoc = sourceMap.findSource(item.textEdit.range);
								if (vueLoc) {
									item.textEdit.range = vueLoc.range;
								}
							}
							if (item.additionalTextEdits) {
								for (const textEdit of item.additionalTextEdits) {
									const vueLoc = sourceMap.findSource(item.textEdit.range);
									if (vueLoc) {
										textEdit.range = vueLoc.range;
									}
								}
							}
						}
					}
					result = result.concat(_result);
				}
			}
			return result;
		}
	}
}