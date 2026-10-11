/*\

Tests the data model and geometry behind the Pinboard engine.

\*/

describe("Pinboard", function() {

var Model = require("$:/plugins/lasjoh-toho/pinboard/lib/model.js");
var Pinboard = $tw.modules.getModulesByTypeAsHashmap("graphengine").Pinboard;

it("declares itself as a graph engine", function() {
	expect(Pinboard).toBeDefined();
	expect(Pinboard.properties.graph.store.type).toBe("string");
	expect(Pinboard.properties.nodes.fields.type).toBe("string");
	expect(Pinboard.properties.nodes.free.variables).toEqual(["x", "y"]);
});

it("parses and normalizes documents", function() {
	expect(Model.parseDoc("")).toEqual(Model.emptyDoc());
	expect(Model.parseDoc("not json").shapes).toEqual([]);
	var doc = Model.parseDoc(JSON.stringify({
		cards: {A: {x: "10", y: 20, w: 200, fields: "title tags", junk: 1}, B: "bad"},
		shapes: [
			{id: "r", type: "rect", x: 10, y: 10, w: -5, h: 8},
			{id: "p", type: "pen", points: [[0, 0], [1, 1], ["x", 2]]},
			{id: "short", type: "pen", points: [[0, 0]]},
			{id: "u", type: "unknown"},
			{id: "r", type: "rect", x: 0, y: 0, w: 1, h: 1}
		],
		steps: [{kind: "frame", ref: "r"}, {kind: "view", x: 0, y: 0, w: 0, h: 5}, {kind: "bogus"}],
		view: {x: 1, y: 2, scale: 0.5}
	}));
	expect(doc.cards.A).toEqual({x: 10, y: 20, w: 200, fields: "title tags"});
	expect(doc.cards.B).toBeUndefined();
	expect(doc.shapes.map(function(s) { return s.id; })).toEqual(["r", "p"]);
	expect(doc.shapes[0]).toEqual(jasmine.objectContaining({x: 5, w: 5, h: 8, layer: "front"}));
	expect(doc.shapes[1].points).toEqual([[0, 0], [1, 1]]);
	expect(doc.steps.length).toBe(1);
	expect(doc.view).toEqual({x: 1, y: 2, scale: 0.5});
	// Round trip
	expect(Model.parseDoc(Model.serializeDoc(doc))).toEqual(doc);
});

it("removes steps along with their shapes", function() {
	var doc = Model.parseDoc(JSON.stringify({
		shapes: [{id: "f", type: "frame", x: 0, y: 0, w: 10, h: 10}],
		steps: [{id: "1", kind: "frame", ref: "f"}, {id: "2", kind: "card", ref: "f"}]}));
	Model.removeShape(doc, "f");
	expect(doc.shapes).toEqual([]);
	expect(doc.steps.map(function(s) { return s.id; })).toEqual(["2"]);
});

it("resolves which fields a card shows", function() {
	expect(Model.resolveFields(undefined, undefined, undefined)).toEqual(["title", "text"]);
	expect(Model.resolveFields(undefined, undefined, "title caption")).toEqual(["title", "caption"]);
	expect(Model.resolveFields(undefined, "tags", "title caption")).toEqual(["tags"]);
	expect(Model.resolveFields("text [[my field]]", "tags", "title")).toEqual(["text", "my field"]);
	// An explicit empty choice means "show nothing but the card"
	expect(Model.resolveFields("", "tags", "title")).toEqual([]);
	expect(Model.chooserFields(["title", "text", "tags", "draft.of", "alpha"], ["text", "title"]))
		.toEqual(["text", "title", "alpha", "tags"]);
});

it("computes shape bounds, moves and resizes", function() {
	var pen = {type: "pen", width: 4, points: [[0, 0], [10, 20]]};
	expect(Model.shapeBounds(pen)).toEqual({x: -2, y: -2, w: 14, h: 24});
	Model.translateShape(pen, 5, -5);
	expect(pen.points).toEqual([[5, -5], [15, 15]]);
	Model.resizeShape(pen, {x: 5, y: -5, w: 10, h: 20}, {x: 0, y: 0, w: 20, h: 10});
	expect(pen.points).toEqual([[0, 0], [20, 10]]);
	var rect = {type: "rect", x: 0, y: 0, w: 10, h: 10};
	Model.resizeShape(rect, Model.shapeBounds(rect), {x: 10, y: 10, w: -20, h: 5});
	expect(rect).toEqual(jasmine.objectContaining({x: -10, y: 10, w: 20, h: 5}));
});

it("clips edges to card borders", function() {
	var rect = {x: -50, y: -25, w: 100, h: 50};
	expect(Model.clipToRect(rect, 200, 0)).toEqual({x: 50, y: 0});
	expect(Model.clipToRect(rect, 0, -100)).toEqual({x: 0, y: -25});
	expect(Model.clipToRect(rect, 10, 0)).toEqual({x: 10, y: 0});
});

it("fits rectangles into the view and zooms around a point", function() {
	var cam = Model.fitRect({x: 0, y: 0, w: 200, h: 100}, 400, 400, 0);
	expect(cam).toEqual({s: 2, r: 0, x: 0, y: 100});
	var zoomed = Model.zoomAt({x: 0, y: 0, s: 1}, 2, 100, 100);
	// The point under the cursor stays put.
	expect((100 - zoomed.x) / zoomed.s).toBeCloseTo(100);
	expect(zoomed.s).toBe(2);
	expect(Model.viewRect({x: -100, y: -50, s: 2}, 400, 200)).toEqual({x: 50, y: 25, w: 200, h: 100});
});

it("interpolates cameras smoothly between both ends", function() {
	var from = {x: 0, y: 0, s: 1, r: 0}, to = {x: -900, y: -300, s: 3, r: 0};
	var path = Model.interpolateCamera(from, to, 800, 600);
	var start = path(0), end = path(1);
	expect(start.s).toBeCloseTo(1);
	expect(start.x).toBeCloseTo(0);
	expect(end).toEqual(to);
	expect(path.duration).toBeGreaterThanOrEqual(500);
	// Long flights zoom out on the way.
	var far = Model.interpolateCamera({x: 0, y: 0, s: 1}, {x: -20000, y: 0, s: 1}, 800, 600);
	expect(far(0.5).s).toBeLessThan(1);
	// Pure zoom works too.
	var zoom = Model.interpolateCamera({x: 400, y: 300, s: 1}, {x: 400 - 400, y: 300 - 300, s: 2}, 800, 600);
	expect(zoom(1).s).toBe(2);
	expect(zoom(0.5).s).toBeGreaterThan(1);
});

it("handles rotated cameras", function() {
	var Camera = require("$:/plugins/lasjoh-toho/pinboard/lib/camera.js");
	// A frame turned by 90 degrees fills the view upright.
	var cam = Camera.fitRect({x: 0, y: 0, w: 200, h: 100}, 400, 200, 0, 8, 90);
	expect(cam.r).toBe(-90);
	expect(cam.s).toBe(2);
	var center = Camera.toWorld(cam, 200, 100);
	expect(center.x).toBeCloseTo(100);
	expect(center.y).toBeCloseTo(50);
	// toScreen and toWorld are inverses.
	var p = Camera.toScreen(cam, 13, -7), back = Camera.toWorld(cam, p.x, p.y);
	expect(back.x).toBeCloseTo(13);
	expect(back.y).toBeCloseTo(-7);
	// Rotation turns the short way round.
	var path = Camera.interpolate({x: 0, y: 0, s: 1, r: 170}, {x: 0, y: 0, s: 1, r: -170}, 400, 200);
	expect(path(0.5).r).toBeCloseTo(180);
	expect(path(1).r).toBe(-170);
});

it("bounds rotated shapes and keeps effects", function() {
	var doc = Model.parseDoc(JSON.stringify({shapes: [
		{id: "f", type: "frame", x: 0, y: 0, w: 100, h: 50, rot: 450, build: "t1", exit: ""}]}));
	var shape = doc.shapes[0];
	expect(shape.rot).toBe(90);
	expect(shape.build).toBe("t1");
	expect(shape.exit).toBeUndefined();
	var b = Model.shapeBounds(shape);
	expect(b.w).toBeCloseTo(50);
	expect(b.h).toBeCloseTo(100);
	expect(b.x).toBeCloseTo(25);
	expect(Model.parseDoc(JSON.stringify({cards: {A: {exit: "t2"}}})).cards.A).toEqual({exit: "t2"});
});

it("cuts long text at the first break and finds the first image", function() {
	var Text = require("$:/plugins/lasjoh-toho/pinboard/lib/text.js");
	expect(Text.excerpt("One<br>two")).toBe("One");
	expect(Text.excerpt("One<br/>two")).toBe("One");
	expect(Text.excerpt("One line\nstill one\n\nSecond paragraph")).toBe("One line\nstill one");
	expect(Text.excerpt("No break at all")).toBe("No break at all");
	var wiki = new $tw.Wiki();
	wiki.addTiddler({title: "pic.png", type: "image/png", text: "AAAA"});
	wiki.addTiddler({title: "A", text: "Intro\n\n<img src='x.jpg'> and [img[pic.png]]"});
	wiki.addTiddler({title: "B", text: "Intro {{pic.png}} then [img width=20 [other.png]]"});
	wiki.addTiddler({title: "C", text: "Just text {{A}}"});
	expect(Text.firstImage(wiki, "A")).toBe("<img src='x.jpg'>");
	expect(Text.firstImage(wiki, "B")).toBe("[img[pic.png]]");
	expect(Text.firstImage(wiki, "C")).toBe("");
	expect(Text.firstImage(wiki, "pic.png")).toBe("[img[pic.png]]");
	expect(wiki.filterTiddlers("[[A]pinboardexcerpt[]]")).toEqual(["Intro"]);
	expect(wiki.filterTiddlers("[[B]pinboardimage[]]")).toEqual(["[img[pic.png]]"]);
});

it("keeps text modes, hidden shapes and the background", function() {
	var doc = Model.parseDoc(JSON.stringify({
		cards: {A: {textMode: "break", presentMode: "full"}, B: {textMode: "bogus"}},
		shapes: [{id: "s", type: "rect", x: 0, y: 0, w: 1, h: 1, hidden: true}],
		background: {color: "#123456", pattern: "grid", image: "Pic", junk: 1},
		view: {x: 0, y: 0, scale: 1}}));
	expect(doc.cards.A).toEqual({textMode: "break", presentMode: "full"});
	expect(doc.cards.B).toEqual({});
	expect(doc.shapes[0].hidden).toBe(true);
	expect(doc.background).toEqual({color: "#123456", pattern: "grid", image: "Pic"});
	expect(Model.parseDoc(JSON.stringify({background: {pattern: "zigzag"}})).background).toBeUndefined();
	expect(Model.parseDoc(Model.serializeDoc(doc)).background).toEqual(doc.background);
});

it("smooths and simplifies strokes", function() {
	expect(Model.smoothPath([[0, 0], [10, 0]])).toBe("M0 0L10 0");
	expect(Model.smoothPath([[0, 0], [10, 0], [20, 10]])).toBe("M0 0Q10 0 15 5L20 10");
	expect(Model.simplifyPoints([[0, 0], [0.1, 0], [5, 0], [5.2, 0], [10, 0]], 1)).toEqual([[0, 0], [5, 0], [10, 0]]);
});

it("picks readable text colors", function() {
	expect(Model.contrastColor("#ffffff")).toBe("#111");
	expect(Model.contrastColor("#123")).toBe("#fff");
	expect(Model.contrastColor("rgb(250, 250, 200)")).toBe("#111");
	expect(Model.contrastColor("teal")).toBe("");
});

});
