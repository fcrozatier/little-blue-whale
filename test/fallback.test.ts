import { describe, expect, test } from "vitest";
import { compile } from "../blue-whale";

describe("fallback tokens", () => {
	test("work", () => {
		const lexer = compile([
			{ type: "op", match: /[._]/ },
			{ type: "text", fallback: true },
		]);
		lexer.reset(".this_that.");
		expect(lexer.next()).toMatchObject({ type: "op", value: "." });
		expect(lexer.next()).toMatchObject({ type: "text", value: "this" });
		expect(lexer.next()).toMatchObject({ type: "op", value: "_" });
		expect(lexer.next()).toMatchObject({ type: "text", value: "that" });
		expect(lexer.next()).toMatchObject({ type: "op", value: "." });
	});

	test("prevent multiple fallbacks", () => {
		expect(() =>
			compile([
				{ type: "op", match: /[._]/ },
				{ type: "text", fallback: true },
				{ type: "text2", fallback: true },
			]),
		).toThrow("Multiple fallbacks not allowed");
	});

	test(`can be at the end of the input`, () => {
		const lexer = compile([
			{ type: "op", match: /[._]/ },
			{ type: "text", fallback: true },
		]);
		lexer.reset(".stuff");
		expect(lexer.next()).toMatchObject({ type: "op", value: "." });
		expect(lexer.next()).toMatchObject({ type: "text", value: "stuff" });
	});

	test(`work if there are characters after the last token`, () => {
		const lexer = compile([
			{
				type: "op",
				match: /[._]/,
			},
			{ type: "text", fallback: true },
		]);
		lexer.reset("stuff.");
		expect(lexer.next()).toMatchObject({ type: "text", value: "stuff" });
		expect(lexer.next()).toMatchObject({ type: "op", value: "." });
	});

	// 	test("work on stateful lexers", () => {
	// 		const lexer = states({
	// 			main: {
	// 				op: /[._]/,
	// 				switch: { match: "|", next: "other" },
	// 				text: fallback,
	// 			},
	// 			other: {
	// 				op: /[+-]/,
	// 			},
	// 		});
	// 		lexer.reset("foo.bar_baz|++-!");
	// 		expect(lexer.next()).toMatchObject({ type: "text", value: "foo" });
	// 		expect(lexer.next()).toMatchObject({ type: "op", value: "." });
	// 		expect(lexer.next()).toMatchObject({ type: "text", value: "bar" });
	// 		expect(lexer.next()).toMatchObject({ type: "op", value: "_" });
	// 		expect(lexer.next()).toMatchObject({ type: "text", value: "baz" });
	// 		expect(lexer.next()).toMatchObject({ type: "switch", value: "|" });
	// 		expect(lexer.next()).toMatchObject({ type: "op", value: "+" });
	// 		expect(lexer.next()).toMatchObject({ type: "op", value: "+" });
	// 		expect(lexer.next()).toMatchObject({ type: "op", value: "-" });
	// 		expect(() => lexer.next()).toThrow("invalid syntax");
	// 	});

	test(`are never empty`, () => {
		const lexer = compile([
			{
				type: "op",
				match: /[._]/,
			},
			{ type: "text", fallback: true },
		]);
		lexer.reset(".._._");
		expect(lexer.next()).toMatchObject({ type: "op", value: "." });
		expect(lexer.next()).toMatchObject({ type: "op", value: "." });
		expect(lexer.next()).toMatchObject({ type: "op", value: "_" });
		expect(lexer.next()).toMatchObject({ type: "op", value: "." });
		expect(lexer.next()).toMatchObject({ type: "op", value: "_" });
	});

	test(`report token positions correctly`, () => {
		const lexer = compile([
			{
				type: "op",
				match: /[._]/,
			},
			{ type: "text", fallback: true },
		]);
		lexer.reset(".this_th\nat.");
		expect(lexer.next()).toMatchObject({ value: ".", offset: 0 });
		expect(lexer.next()).toMatchObject({ value: "this", offset: 1 });
		expect(lexer.next()).toMatchObject({ value: "_", offset: 5 });
		expect(lexer.next()).toMatchObject({ value: "th\nat", offset: 6 });
		expect(lexer.next()).toMatchObject({ value: ".", offset: 11 });
	});

	// 	test(`report token line numbers correctly`, () => {
	// 		const lexer = compile({
	// 			str: { lineBreaks: true, match: /"[^]+?"/ },
	// 			bare: fallback,
	// 		});
	// 		lexer.reset('a\nb"some\nthing" else\ngoes\nhere\n\n"\nand here"\n');
	// 		expect(lexer.next()).toMatchObject({ value: "a\nb", line: 1, col: 1 });
	// 		expect(lexer.next()).toMatchObject({
	// 			value: '"some\nthing"',
	// 			line: 2,
	// 			col: 2,
	// 		});
	// 		expect(lexer.next()).toMatchObject({
	// 			value: " else\ngoes\nhere\n\n",
	// 			line: 3,
	// 			col: 7,
	// 		});
	// 		expect(lexer.next()).toMatchObject({
	// 			value: '"\nand here"',
	// 			line: 7,
	// 			col: 1,
	// 		});
	// 		expect(lexer.next()).toMatchObject({ value: "\n", line: 8, col: 10 });
	// 	});

	test.skip("don't throw token errors until next() is called again", () => {
		const lexer = compile([
			{ type: "op", match: /[._]/, shouldThrow: true },
			{ type: "text", fallback: true },
		]);
		lexer.reset("stuff.");
		expect(lexer.next()).toMatchObject({ type: "text", value: "stuff" });
		expect(() => lexer.next()).toThrow("invalid syntax");
	});
});