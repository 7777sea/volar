import { TemplateChildNode, ElementNode, NodeTypes, RootNode, ElementTypes } from '@vue/compiler-core';
import { createHtmlPugMapper } from '@volar/pug';
import { MapedMode, TsMappingData, Mapping } from './sourceMaps';

export function transformVueHtml(pugData: { html: string, pug: string } | undefined, node: RootNode) {
	const mappings: Mapping<TsMappingData>[] = [];
	let elementIndex = 0;
	const pugMapper = pugData ? createHtmlPugMapper(pugData.pug, pugData.html) : undefined;
	const text = worker('', node);

	return {
		mappings,
		text,
	};

	function worker(_code: string, node: TemplateChildNode | RootNode, dontCreateBlock = false): string {
		if (node.type === NodeTypes.ROOT) {
			for (const childNode of node.children) {
				_code += `{\n`;
				_code = worker(_code, childNode);
				_code += `}\n`;
			}
		}
		else if (node.type === NodeTypes.ELEMENT) {
			// props
			if (!dontCreateBlock) _code += `{\n`;
			// _code += `// ${node.tag}\n`;
			if (node.tagType === ElementTypes.COMPONENT) { // TODO: should not has indent
				// +1 to remove '<' from html tag
				const sourceRanges = [{
					start: node.loc.start.offset + 1,
					end: node.loc.start.offset + 1 + node.tag.length,
				}];
				if (!node.isSelfClosing) {
					sourceRanges.push({
						start: node.loc.end.offset - 1 - node.tag.length,
						end: node.loc.end.offset - 1,
					});
				}
				mapping(`__VLS_components['${node.tag}']`, node.tag, MapedMode.Gate, true, false, [{
					start: node.loc.start.offset + 1,
					end: node.loc.start.offset + 1 + node.tag.length,
				}], false);
				_code += `__VLS_components[`;
				mapping(`'${node.tag}'`, node.tag, MapedMode.Gate, false, false, sourceRanges, false);
				_code += `'`;
				mapping(node.tag, node.tag, MapedMode.Offset, false, false, sourceRanges);
				_code += `'] = {\n`;
				writeProps(node, true);
				_code += '};\n';
			}

			writeProps(node, false);

			function writeProps(node: ElementNode, isInWrap: boolean) {
				for (const prop of node.props) {
					if (
						prop.type === NodeTypes.DIRECTIVE
						&& prop.arg
						&& prop.exp
						&& prop.arg.type === NodeTypes.SIMPLE_EXPRESSION
						&& prop.exp.type === NodeTypes.SIMPLE_EXPRESSION
						&& !prop.exp.isConstant // style='z-index: 2' will compile to {'z-index':'2'}
					) {
						const propName = prop.arg.content;
						const propValue = prop.exp.content;
						let propNameStart = prop.arg.loc.start.offset;
						let propValueStart = prop.exp.loc.start.offset;

						if (isInWrap) {
							// bind only
							if (prop.name === 'bind') {
								mapping(`'${propName}'`, propName, MapedMode.Gate, false, false, [{
									start: propNameStart,
									end: propNameStart + propName.length,
								}], false);
								_code += `'`;
								mapping(propName, propName, MapedMode.Offset, false, false, [{
									start: propNameStart,
									end: propNameStart + propName.length,
								}]);
								_code += `': (${propValue}),\n`;
							}
						}
						else {
							_code += `(`;
							mapping(propValue, propValue, MapedMode.Offset, false, true, [{
								start: propValueStart,
								end: propValueStart + propValue.length,
							}])
							_code += `);\n`;
						}
					}
					else if (
						prop.type === NodeTypes.DIRECTIVE
						&& prop.exp
						&& prop.exp.type === NodeTypes.SIMPLE_EXPRESSION
						&& !prop.exp.isConstant // style='z-index: 2' will compile to {'z-index':'2'}
					) {
						const propValue = prop.exp.content;
						let propValueStart = prop.exp.loc.start.offset;

						if (propValueStart !== undefined) { // TODO: Pug support
							if (isInWrap) {
								// no prop name
							}
							else {
								_code += `(`;
								mapping(propValue, propValue, MapedMode.Offset, false, true, [{
									start: propValueStart,
									end: propValueStart + propValue.length,
								}])
								_code += `);\n`;
							}
						}
					}
					else if (
						prop.type === NodeTypes.ATTRIBUTE
						&& prop.value
					) {
						const propName = prop.name;
						const propValue = prop.value.content;
						let propNameStart = prop.loc.start.offset;
						let propValueStart = prop.value.loc.start.offset + prop.value.loc.source.indexOf(propValue); // 'test' => 'tex => test

						if (isInWrap) {
							mapping(`'${propName}'`, propName, MapedMode.Gate, false, false, [{
								start: propNameStart,
								end: propNameStart + propName.length,
							}], false);
							_code += `'`;
							mapping(propName, propName, MapedMode.Offset, false, false, [{
								start: propNameStart,
								end: propNameStart + propName.length,
							}]);
							_code += `': '${propValue}',\n`;
						}
						else {
							mapping(`'${propValue}'`, propValue, MapedMode.Gate, false, false, [{
								start: propValueStart,
								end: propValueStart + propValue.length,
							}], false)
							_code += `'`;
							mapping(propValue, propValue, MapedMode.Offset, false, true, [{
								start: propValueStart,
								end: propValueStart + propValue.length,
							}])
							_code += `';\n`;
						}
					}
				}
			}
			// childs
			for (const childNode of node.children) {
				_code = worker(_code, childNode);
			}
			if (!dontCreateBlock) _code += '}\n';
		}
		else if (node.type === NodeTypes.TEXT_CALL) {
			// {{ var }}
			_code = worker(_code, node.content);
		}
		else if (node.type === NodeTypes.COMPOUND_EXPRESSION) {
			// {{ ... }} {{ ... }}
			for (const childNode of node.children) {
				if (typeof childNode === 'object') {
					_code = worker(_code, childNode as TemplateChildNode);
				}
			}
		}
		else if (node.type === NodeTypes.INTERPOLATION) {
			// {{ ... }}
			const context = node.loc.source.substring(2, node.loc.source.length - 2);
			let start = node.loc.start.offset + 2;

			_code += `{`;
			mapping(context, context, MapedMode.Offset, false, true, [{
				start: start,
				end: start + context.length,
			}]);
			_code += `};\n`;
		}
		else if (node.type === NodeTypes.IF) {
			// v-if / v-else-if / v-else
			let childHasBlock = true;
			if (node.codegenNode) childHasBlock = node.loc.source.substring(1, 9) !== 'template';

			let firstIf = true;

			for (const branch of node.branches) {
				if (branch.condition) {
					if (branch.condition.type === NodeTypes.SIMPLE_EXPRESSION) {

						const context = branch.condition.content;
						let start = branch.condition.loc.start.offset;

						if (firstIf) {
							firstIf = false;
							_code += `if (\n`;
							_code += `(`;
							mapping(context, context, MapedMode.Offset, false, true, [{
								start: start,
								end: start + context.length,
							}]);
							_code += `)\n`;
							_code += `) {\n`;
						}
						else {
							_code += `else if (\n`;
							_code += `(`;
							mapping(context, context, MapedMode.Offset, false, true, [{
								start: start,
								end: start + context.length,
							}]);
							_code += `)\n`;
							_code += `) {\n`;
						}
						for (const childNode of branch.children) {
							_code = worker(_code, childNode, childHasBlock);
						}
						_code += '}\n';
					}
				}
				else {
					_code += 'else {\n';
					for (const childNode of branch.children) {
						_code = worker(_code, childNode, childHasBlock);
					}
					_code += '}\n';
				}
			}
		}
		else if (node.type === NodeTypes.FOR) {
			// v-for
			const source = node.parseResult.source;
			const value = node.parseResult.value;
			const key = node.parseResult.key;
			const index = node.parseResult.index;
			let childHasBlock = true;
			if (node.codegenNode) childHasBlock = node.codegenNode.loc.source.substring(1, 9) !== 'template';

			if (value
				&& source.type === NodeTypes.SIMPLE_EXPRESSION
				&& value.type === NodeTypes.SIMPLE_EXPRESSION) {

				let start_value = value.loc.start.offset;
				let start_source = source.loc.start.offset;

				const sourceVarName = `__VLS_${elementIndex++}`;
				// const __VLS_100 = 123;
				// const __VLS_100 = vmValue;
				_code += `const ${sourceVarName} = __VLS_getVforSourceType(`;
				mapping(source.content, source.content, MapedMode.Offset, false, false, [{
					start: start_source,
					end: start_source + source.content.length,
				}]);
				_code += `);\n`;
				_code += `for (__VLS_for_key in `;
				mapping(sourceVarName, source.content, MapedMode.Gate, true, false, [{
					start: source.loc.start.offset,
					end: source.loc.end.offset,
				}]);
				_code += `) {\n`;

				_code += `const `;
				mapping(value.content, value.content, MapedMode.Offset, false, false, [{
					start: start_value,
					end: start_value + value.content.length,
				}]);
				_code += ` = ${sourceVarName}[__VLS_for_key];\n`;

				if (key && key.type === NodeTypes.SIMPLE_EXPRESSION) {
					let start_key = key.loc.start.offset;
					_code += `const `;
					mapping(key.content, key.content, MapedMode.Offset, false, false, [{
						start: start_key,
						end: start_key + key.content.length,
					}]);
					_code += ` = 0 as any;\n`;
				}
				if (index && index.type === NodeTypes.SIMPLE_EXPRESSION) {
					let start_index = index.loc.start.offset;
					_code += `const `;
					mapping(index.content, index.content, MapedMode.Offset, false, false, [{
						start: start_index,
						end: start_index + index.content.length,
					}]);
					_code += ` = 0;\n`;
				}
				for (const childNode of node.children) {
					_code = worker(_code, childNode, childHasBlock);
				}
				_code += '}\n';
			}
		}
		else if (node.type === NodeTypes.TEXT) {
			// not needed progress
		}
		else if (node.type === NodeTypes.COMMENT) {
			// not needed progress
		}
		else {
			_code += `// Unprocessed node type: ${node.type} json: ${JSON.stringify(node.loc)}\n`
		}
		return _code;

		function mapping(mapCode: string, pugSearchCode: string, mode: MapedMode, diagnosticOnly: boolean, formatting: boolean, sourceRanges: { start: number, end: number }[], addCode = true) {
			if (pugMapper) {
				sourceRanges = sourceRanges.map(range => ({ ...range })); // clone
				for (const sourceRange of sourceRanges) {
					const newStart = pugMapper(pugSearchCode, sourceRange.start);
					if (newStart !== undefined) {
						const offset = newStart - sourceRange.start;
						sourceRange.start += offset;
						sourceRange.end += offset;
					}
					else {
						sourceRange.start = -1;
						sourceRange.end = -1;
					}
				}
				sourceRanges = sourceRanges.filter(range => range.start !== -1);
			}
			const range = {
				start: _code.length,
				end: _code.length + mapCode.length,
			};
			for (const sourceRange of sourceRanges) {
				mappings.push({
					mode,
					originalRange: sourceRange,
					mappingRange: range,
					data: {
						vueTag: 'template',
						capabilities: {
							// TODO
							basic: !diagnosticOnly,
							references: !diagnosticOnly,
							diagnostic: true,
							formatting,
						},
					},
				});
			}
			if (addCode) {
				_code += mapCode;
			}
		}
	};
};