import type { Lexer } from ".";
import type { TypeMapper } from ".";
import type { Rules } from ".";

function isRegExp(o: unknown): o is RegExp {
	return o instanceof RegExp;
}

function isObject(o: unknown) {
	return !!o && typeof o === "object" && !isRegExp(o) && !Array.isArray(o);
}

function reEscape(s: string) {
	return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function reGroups(s: string) {
	const re = new RegExp("|" + s);
	return re.exec("").length - 1;
}

function reCapture(s) {
	return "(" + s + ")";
}

function reUnion(regexps: RegExp[]) {
	if (!regexps.length) return "(?!)";
	return regexps.map((s) => "(?:" + s + ")").join("|");
}

function regexpOrLiteral(obj: string | RegExp) {
	if (typeof obj === "string") {
		return "(?:" + reEscape(obj) + ")";
	} else if (isRegExp(obj)) {
		// TODO: consider /u support
		if (obj.ignoreCase) throw new Error("RegExp /i flag not allowed");
		if (obj.global) throw new Error("RegExp /g flag is implied");
		if (obj.sticky) throw new Error("RegExp /y flag is implied");
		if (obj.multiline) throw new Error("RegExp /m flag is implied");
		return obj.source;
	} else {
		throw new Error("Not a pattern: " + obj);
	}
}

function pad(s: string, length: number) {
	if (s.length > length) {
		return s;
	}
	return Array(length - s.length + 1).join(" ") + s;
}

function lastNLines(string: string, numLines: number) {
	let position = string.length;
	let lineBreaks = 0;
	while (true) {
		const idx = string.lastIndexOf("\n", position - 1);
		if (idx === -1) {
			break;
		} else {
			lineBreaks++;
		}
		position = idx;
		if (lineBreaks === numLines) {
			break;
		}
		if (position === 0) {
			break;
		}
	}
	const startPosition = lineBreaks < numLines ? 0 : position + 1;
	return string.substring(startPosition).split("\n");
}

function objectToRules(object: Record<string, unknown>) {
	const keys = Object.getOwnPropertyNames(object);
	const result = [];
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const thing = object[key];
		const rules = [].concat(thing);
		if (key === "include") {
			for (let j = 0; j < rules.length; j++) {
				result.push({ include: rules[j] });
			}
			continue;
		}
		let match = [];
		rules.forEach(function (rule) {
			if (isObject(rule)) {
				if (match.length) result.push(ruleOptions(key, match));
				result.push(ruleOptions(key, rule));
				match = [];
			} else {
				match.push(rule);
			}
		});
		if (match.length) result.push(ruleOptions(key, match));
	}
	return result;
}

function arrayToRules(array) {
	const result = [];
	for (let i = 0; i < array.length; i++) {
		const obj = array[i];
		if (obj.include) {
			const include = [].concat(obj.include);
			for (let j = 0; j < include.length; j++) {
				result.push({ include: include[j] });
			}
			continue;
		}
		if (!obj.type) {
			throw new Error("Rule has no type: " + JSON.stringify(obj));
		}
		result.push(ruleOptions(obj.type, obj));
	}
	return result;
}

function ruleOptions(type, obj) {
	if (!isObject(obj)) {
		obj = { match: obj };
	}
	if (obj.include) {
		throw new Error("Matching rules cannot also include states");
	}

	// nb. error and fallback imply lineBreaks
	let options = {
		defaultType: type,
		lineBreaks: !!obj.error || !!obj.fallback,
		pop: false,
		next: null,
		push: null,
		error: false,
		fallback: false,
		value: null,
		type: null,
		shouldThrow: false,
	};

	options = Object.assign(options, obj);

	// type transform cannot be a string
	if (typeof options.type === "string" && type !== options.type) {
		throw new Error(
			"Type transform cannot be a string (type '" + options.type + "' for token '" + type + "')",
		);
	}

	// convert to array
	const match = options.match;
	options.match = Array.isArray(match) ? match : match ? [match] : [];
	options.match.sort(function (a, b) {
		return isRegExp(a) && isRegExp(b)
			? 0
			: isRegExp(b)
				? -1
				: isRegExp(a)
					? +1
					: b.length - a.length;
	});
	return options;
}

function toRules(spec) {
	return Array.isArray(spec) ? arrayToRules(spec) : objectToRules(spec);
}

const defaultErrorRule = ruleOptions("error", {
	lineBreaks: true,
	shouldThrow: true,
});
function compileRules(rules, hasStates) {
	let errorRule = null;
	const fast = Object.create(null);
	let fastAllowed = true;
	let unicodeFlag = null;
	const groups = [];
	const parts = [];

	// If there is a fallback rule, then disable fast matching
	for (let i = 0; i < rules.length; i++) {
		if (rules[i].fallback) {
			fastAllowed = false;
		}
	}

	for (let i = 0; i < rules.length; i++) {
		const options = rules[i];

		if (options.include) {
			// all valid inclusions are removed by states() preprocessor
			throw new Error("Inheritance is not allowed in stateless lexers");
		}

		if (options.error || options.fallback) {
			// errorRule can only be set once
			if (errorRule) {
				if (!options.fallback === !errorRule.fallback) {
					throw new Error(
						"Multiple " +
							(options.fallback ? "fallback" : "error") +
							" rules not allowed (for token '" +
							options.defaultType +
							"')",
					);
				} else {
					throw new Error(
						"fallback and error are mutually exclusive (for token '" + options.defaultType + "')",
					);
				}
			}
			errorRule = options;
		}

		const match = options.match.slice();
		if (fastAllowed) {
			while (match.length && typeof match[0] === "string" && match[0].length === 1) {
				const word = match.shift();
				fast[word.charCodeAt(0)] = options;
			}
		}

		// Warn about inappropriate state-switching options
		if (options.pop || options.push || options.next) {
			if (!hasStates) {
				throw new Error(
					"State-switching options are not allowed in stateless lexers (for token '" +
						options.defaultType +
						"')",
				);
			}
			if (options.fallback) {
				throw new Error(
					"State-switching options are not allowed on fallback tokens (for token '" +
						options.defaultType +
						"')",
				);
			}
		}

		// Only rules with a .match are included in the RegExp
		if (match.length === 0) {
			continue;
		}
		fastAllowed = false;

		groups.push(options);

		// Check unicode flag is used everywhere or nowhere
		for (let j = 0; j < match.length; j++) {
			const obj = match[j];
			if (!isRegExp(obj)) {
				continue;
			}

			if (unicodeFlag === null) {
				unicodeFlag = obj.unicode;
			} else if (unicodeFlag !== obj.unicode && options.fallback === false) {
				throw new Error("If one rule is /u then all must be");
			}
		}

		// convert to RegExp
		const pat = reUnion(match.map(regexpOrLiteral));

		// validate
		const regexp = new RegExp(pat);
		if (regexp.test("")) {
			throw new Error("RegExp matches empty string: " + regexp);
		}
		const groupCount = reGroups(pat);
		if (groupCount > 0) {
			throw new Error("RegExp has capture groups: " + regexp + "\nUse (?: … ) instead");
		}

		// try and detect rules matching newlines
		if (!options.lineBreaks && regexp.test("\n")) {
			throw new Error("Rule should declare lineBreaks: " + regexp);
		}

		// store regex
		parts.push(reCapture(pat));
	}

	// If there's no fallback rule, use the sticky flag so we only look for
	// matches at the current index.
	//
	// If we don't support the sticky flag, then fake it using an irrefutable
	// match (i.e. an empty pattern).
	const fallbackRule = errorRule && errorRule.fallback;
	let flags = !fallbackRule ? "ym" : "gm";

	if (unicodeFlag === true) flags += "u";
	const combined = new RegExp(reUnion(parts), flags);
	return {
		regexp: combined,
		groups: groups,
		fast: fast,
		error: errorRule || defaultErrorRule,
	};
}

export function compile(rules: Rules): Lexer {
	const result = compileRules(toRules(rules));
	return new Lexer({ start: result }, "start");
}

function checkStateGroup(g, name: string, map) {
	const state = g && (g.push || g.next);
	if (state && !map[state]) {
		throw new Error(
			"Missing state '" + state + "' (in token '" + g.defaultType + "' of state '" + name + "')",
		);
	}
	if (g && g.pop && +g.pop !== 1) {
		throw new Error("pop must be 1 (in token '" + g.defaultType + "' of state '" + name + "')");
	}
}
export const states = function compileStates(
	states: { [x: string]: Rules },
	start?: string,
): Lexer {
	const all = states.$all ? toRules(states.$all) : [];
	delete states.$all;

	const keys = Object.getOwnPropertyNames(states);
	if (!start) start = keys[0];

	const ruleMap = Object.create(null);
	for (let i = 0; i < keys.length; i++) {
		let key = keys[i];
		ruleMap[key] = toRules(states[key]).concat(all);
	}
	for (let i = 0; i < keys.length; i++) {
		let key = keys[i];
		const rules = ruleMap[key];
		const included = Object.create(null);
		for (let j = 0; j < rules.length; j++) {
			const rule = rules[j];
			if (!rule.include) continue;
			const splice = [j, 1];
			if (rule.include !== key && !included[rule.include]) {
				included[rule.include] = true;
				const newRules = ruleMap[rule.include];
				if (!newRules) {
					throw new Error(
						"Cannot include nonexistent state '" + rule.include + "' (in state '" + key + "')",
					);
				}
				for (let k = 0; k < newRules.length; k++) {
					const newRule = newRules[k];
					if (rules.indexOf(newRule) !== -1) continue;
					splice.push(newRule);
				}
			}
			rules.splice.apply(rules, splice);
			j--;
		}
	}

	const map = Object.create(null);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		map[key] = compileRules(ruleMap[key], true);
	}

	for (let i = 0; i < keys.length; i++) {
		const name = keys[i];
		const state = map[name];
		const groups = state.groups;
		for (let j = 0; j < groups.length; j++) {
			checkStateGroup(groups[j], name, map);
		}
		const fastKeys = Object.getOwnPropertyNames(state.fast);
		for (let j = 0; j < fastKeys.length; j++) {
			checkStateGroup(state.fast[fastKeys[j]], name, map);
		}
	}

	return new Lexer(map, start);
};

export const keywords = function keywordTransform(map: {
	[k: string]: string | string[];
}): TypeMapper {
	const reverseMap = new Map();

	const types = Object.getOwnPropertyNames(map);
	for (let i = 0; i < types.length; i++) {
		const tokenType = types[i];
		const item = map[tokenType];
		const keywordList = Array.isArray(item) ? item : [item];
		keywordList.forEach(function (keyword) {
			if (typeof keyword !== "string") {
				throw new Error("keyword must be string (in keyword '" + tokenType + "')");
			}
			reverseMap.set(keyword, tokenType);
		});
	}
	return (k) => reverseMap.get(k);
};

/***************************************************************************/

const Lexer = function (states, state) {
	this.startState = state;
	this.states = states;
	this.buffer = "";
	this.stack = [];
	this.reset();
};

Lexer.prototype.reset = function (data, info) {
	this.buffer = data || "";
	this.index = 0;
	this.line = info ? info.line : 1;
	this.col = info ? info.col : 1;
	this.queuedToken = info ? info.queuedToken : null;
	this.queuedText = info ? info.queuedText : "";
	this.queuedThrow = info ? info.queuedThrow : null;
	this.setState(info ? info.state : this.startState);
	this.stack = info && info.stack ? info.stack.slice() : [];
	return this;
};

Lexer.prototype.save = function () {
	return {
		line: this.line,
		col: this.col,
		state: this.state,
		stack: this.stack.slice(),
		queuedToken: this.queuedToken,
		queuedText: this.queuedText,
		queuedThrow: this.queuedThrow,
	};
};

Lexer.prototype.setState = function (state) {
	if (!state || this.state === state) return;
	this.state = state;
	const info = this.states[state];
	this.groups = info.groups;
	this.error = info.error;
	this.re = info.regexp;
	this.fast = info.fast;
};

Lexer.prototype.popState = function () {
	this.setState(this.stack.pop());
};

Lexer.prototype.pushState = function (state) {
	this.stack.push(this.state);
	this.setState(state);
};

const eat = function (re, buffer) {
	// assume re is /y
	return re.exec(buffer);
};

Lexer.prototype._getGroup = function (match) {
	const groupCount = this.groups.length;
	for (let i = 0; i < groupCount; i++) {
		if (match[i + 1] !== undefined) {
			return this.groups[i];
		}
	}
	throw new Error("Cannot find token type for matched text");
};

function tokenToString() {
	return this.value;
}

Lexer.prototype.next = function () {
	const index = this.index;

	// If a fallback token matched, we don't need to re-run the RegExp
	if (this.queuedGroup) {
		const token = this._token(this.queuedGroup, this.queuedText, index);
		this.queuedGroup = null;
		this.queuedText = "";
		return token;
	}

	const buffer = this.buffer;
	if (index === buffer.length) {
		return; // EOF
	}

	// Fast matching for single characters
	let group = this.fast[buffer.charCodeAt(index)];
	if (group) {
		return this._token(group, buffer.charAt(index), index);
	}

	// Execute RegExp
	const re = this.re;
	re.lastIndex = index;
	const match = eat(re, buffer);

	// Error tokens match the remaining buffer
	const error = this.error;
	if (match == null) {
		return this._token(error, buffer.slice(index, buffer.length), index);
	}

	group = this._getGroup(match);
	const text = match[0];

	if (error.fallback && match.index !== index) {
		this.queuedGroup = group;
		this.queuedText = text;

		// Fallback tokens contain the unmatched portion of the buffer
		return this._token(error, buffer.slice(index, match.index), index);
	}

	return this._token(group, text, index);
};

Lexer.prototype._token = function (group, text, offset) {
	// count line breaks
	let lineBreaks = 0;
	if (group.lineBreaks) {
		const matchNL = /\n/g;
		var nl = 1;
		if (text === "\n") {
			lineBreaks = 1;
		} else {
			while (matchNL.exec(text)) {
				lineBreaks++;
				nl = matchNL.lastIndex;
			}
		}
	}

	const token = {
		type: (typeof group.type === "function" && group.type(text)) || group.defaultType,
		value: typeof group.value === "function" ? group.value(text) : text,
		text: text,
		toString: tokenToString,
		offset: offset,
		lineBreaks: lineBreaks,
		line: this.line,
		col: this.col,
	};
	// nb. adding more props to token object will make V8 sad!

	const size = text.length;
	this.index += size;
	this.line += lineBreaks;
	if (lineBreaks !== 0) {
		this.col = size - nl + 1;
	} else {
		this.col += size;
	}

	// throw, if no rule with {error: true}
	if (group.shouldThrow) {
		const err = new Error(this.formatError(token, "invalid syntax"));
		throw err;
	}

	if (group.pop) this.popState();
	else if (group.push) this.pushState(group.push);
	else if (group.next) this.setState(group.next);

	return token;
};

if (typeof Symbol !== "undefined" && Symbol.iterator) {
	const LexerIterator = function (lexer) {
		this.lexer = lexer;
	};

	LexerIterator.prototype.next = function () {
		const token = this.lexer.next();
		return { value: token, done: !token };
	};

	LexerIterator.prototype[Symbol.iterator] = function () {
		return this;
	};

	Lexer.prototype[Symbol.iterator] = function () {
		return new LexerIterator(this);
	};
}

Lexer.prototype.formatError = function (token, message) {
	if (token == null) {
		// An undefined token indicates EOF
		const text = this.buffer.slice(this.index);
		token = {
			text: text,
			offset: this.index,
			lineBreaks: text.indexOf("\n") === -1 ? 0 : 1,
			line: this.line,
			col: this.col,
		};
	}

	const numLinesAround = 2;
	const firstDisplayedLine = Math.max(token.line - numLinesAround, 1);
	const lastDisplayedLine = token.line + numLinesAround;
	const lastLineDigits = String(lastDisplayedLine).length;
	const displayedLines = lastNLines(this.buffer, this.line - token.line + numLinesAround + 1).slice(
		0,
		5,
	);
	const errorLines = [];
	errorLines.push(message + " at line " + token.line + " col " + token.col + ":");
	errorLines.push("");
	for (let i = 0; i < displayedLines.length; i++) {
		const line = displayedLines[i];
		const lineNo = firstDisplayedLine + i;
		errorLines.push(pad(String(lineNo), lastLineDigits) + "  " + line);
		if (lineNo === token.line) {
			errorLines.push(pad("", lastLineDigits + token.col + 1) + "^");
		}
	}
	return errorLines.join("\n");
};

Lexer.prototype.clone = function () {
	return new Lexer(this.states, this.state);
};

Lexer.prototype.has = function () {
	return true;
};

export const error = Object.freeze({ error: true });
export const fallback = Object.freeze({ fallback: true });