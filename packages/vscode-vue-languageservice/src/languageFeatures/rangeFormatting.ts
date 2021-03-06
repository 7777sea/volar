import {
	FormattingOptions,
	TextEdit,
	Range,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SourceFile } from '../sourceFiles';
import * as prettier from 'prettier';
import * as prettyhtml from '@starptech/prettyhtml';
import type * as ts2 from '@volar/vscode-typescript-languageservice';
const pugBeautify = require('pug-beautify');

export function register(sourceFiles: Map<string, SourceFile>, tsLanguageService: ts2.LanguageService) {
	return (document: TextDocument, range: Range, options: FormattingOptions) => {
		const sourceFile = sourceFiles.get(document.uri);
		if (!sourceFile) return;
		return formattingWorker(sourceFile, document, options, range, tsLanguageService);
	};
}

export function formattingWorker(sourceFile: SourceFile, document: TextDocument, options: FormattingOptions, range: Range, tsLanguageService: ts2.LanguageService): TextEdit[] | undefined {
	let newDocument = document;

	const pugEdits = getPugFormattingEdits();
	const htmlEdits = getHtmlFormattingEdits();
	const cssEdits = getCssFormattingEdits();
	newDocument = applyTextEdits(document, filterEditsByRange([
		...pugEdits,
		...htmlEdits,
		...cssEdits,
	]));
	sourceFile.update(newDocument);

	const tsEdits = getTsFormattingEdits();
	newDocument = applyTextEdits(newDocument, filterEditsByRange(tsEdits));
	sourceFile.update(newDocument);

	const indentTextEdits = patchInterpolationIndent();
	newDocument = applyTextEdits(newDocument, filterEditsByRange(indentTextEdits));
	sourceFile.update(document);

	if (newDocument.getText() === document.getText()) return;

	const editRange = Range.create(
		document.positionAt(0),
		document.positionAt(document.getText().length),
	);
	const textEdit = TextEdit.replace(editRange, newDocument.getText());
	return [textEdit];

	function patchInterpolationIndent() {
		const indentTextEdits: TextEdit[] = [];
		for (const tsSourceMap of sourceFile.getTsSourceMaps()) {
			if (!tsSourceMap.isInterpolation)
				continue;

			for (const maped of tsSourceMap) {
				if (!maped.data.capabilities.formatting)
					continue;

				const textRange = {
					start: newDocument.positionAt(maped.sourceRange.start),
					end: newDocument.positionAt(maped.sourceRange.end),
				};
				const text = newDocument.getText(textRange);
				if (text.indexOf('\n') === -1)
					continue;
				const lines = text.split('\n');
				const removeIndent = getRemoveIndent();
				const baseIndent = getBaseIndent();
				for (let i = 1; i < lines.length; i++) {
					const line = lines[i];
					if (line.startsWith(removeIndent)) {
						lines[i] = line.replace(removeIndent, baseIndent);
					}
				}
				indentTextEdits.push({
					newText: lines.join('\n'),
					range: textRange,
				});

				function getRemoveIndent() {
					const lastLine = lines[lines.length - 1];
					return lastLine.substr(0, lastLine.length - lastLine.trimStart().length);
				}
				function getBaseIndent() {
					const startPos = newDocument.positionAt(maped.sourceRange.start);
					const startLineText = newDocument.getText({ start: startPos, end: { line: startPos.line, character: 0 } });
					return startLineText.substr(0, startLineText.length - startLineText.trimStart().length);
				}
			}
		}
		return indentTextEdits;
	}
	function filterEditsByRange(textEdits: TextEdit[]) {
		return textEdits.filter(edit => edit.range.start.line >= range.start.line && edit.range.end.line <= range.end.line);
	}
	function getCssFormattingEdits() {
		const textEdits: TextEdit[] = [];
		for (const sourceMap of sourceFile.getCssSourceMaps()) {
			for (const maped of sourceMap) {
				const newStyleText = prettier.format(sourceMap.targetDocument.getText(), {
					tabWidth: options.tabSize,
					useTabs: !options.insertSpaces,
					parser: sourceMap.targetDocument.languageId,
				});

				const vueRange = {
					start: sourceMap.sourceDocument.positionAt(maped.sourceRange.start),
					end: sourceMap.sourceDocument.positionAt(maped.sourceRange.end),
				};
				const textEdit = TextEdit.replace(
					vueRange,
					'\n' + newStyleText
				);
				textEdits.push(textEdit);
			}
		}
		return textEdits;
	}
	function getHtmlFormattingEdits() {
		const result: TextEdit[] = [];
		for (const sourceMap of sourceFile.getHtmlSourceMaps()) {
			for (const maped of sourceMap) {

				const prefixes = '<template>';
				const suffixes = '</template>';

				let newHtml = prettyhtml(prefixes + sourceMap.targetDocument.getText() + suffixes, {
					tabWidth: options.tabSize,
					useTabs: !options.insertSpaces,
					printWidth: 100,
				}).contents;
				newHtml = newHtml.trim();
				newHtml = newHtml.substring(prefixes.length, newHtml.length - suffixes.length);

				const vueRange = {
					start: sourceMap.sourceDocument.positionAt(maped.sourceRange.start),
					end: sourceMap.sourceDocument.positionAt(maped.sourceRange.end),
				};
				const textEdit = TextEdit.replace(vueRange, newHtml);
				result.push(textEdit);
			}
		}
		return result;
	}
	function getPugFormattingEdits() {
		const result: TextEdit[] = [];
		for (const sourceMap of sourceFile.getPugSourceMaps()) {
			for (const maped of sourceMap) {
				let newPug = pugBeautify(sourceMap.targetDocument.getText(), {
					tab_size: options.tabSize,
					fill_tab: !options.insertSpaces,
				});
				newPug = '\n' + newPug.trim() + '\n';
				const vueRange = {
					start: sourceMap.sourceDocument.positionAt(maped.sourceRange.start),
					end: sourceMap.sourceDocument.positionAt(maped.sourceRange.end),
				};
				const textEdit = TextEdit.replace(vueRange, newPug);
				result.push(textEdit);
			}
		}
		return result;
	}
	function getTsFormattingEdits() {
		const result: TextEdit[] = [];
		for (const sourceMap of sourceFile.getTsSourceMaps()) {
			const textEdits = tsLanguageService.doFormatting(sourceMap.targetDocument, options);
			for (const textEdit of textEdits) {
				for (const vueLoc of sourceMap.targetToSources(textEdit.range)) {
					if (!vueLoc.maped.data.capabilities.formatting) continue;
					if (vueLoc.range.start.line < range.start.line) continue;
					if (vueLoc.range.end.line > range.end.line) continue;
					if (vueLoc.range.start.line === range.start.line && vueLoc.range.start.character < range.start.character) continue;
					if (vueLoc.range.end.line === range.end.line && vueLoc.range.end.character > range.end.character) continue;
					result.push({
						newText: textEdit.newText,
						range: vueLoc.range,
					});
				}
			}
		}
		return result;
	}
	function applyTextEdits(document: TextDocument, textEdits: TextEdit[]) {

		textEdits = textEdits.sort((a, b) => document.offsetAt(b.range.start) - document.offsetAt(a.range.start));

		let newDocumentText = document.getText();
		for (const textEdit of textEdits) {
			newDocumentText = editText(
				newDocumentText,
				document.offsetAt(textEdit.range.start),
				document.offsetAt(textEdit.range.end),
				textEdit.newText
			)
		}

		return TextDocument.create(document.uri.toString(), document.languageId, document.version + 1, newDocumentText);

		function editText(sourceText: string, startOffset: number, endOffset: number, newText: string) {
			return sourceText.substring(0, startOffset)
				+ newText
				+ sourceText.substring(endOffset, sourceText.length)
		}
	}
}