/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/edges.js
type: application/javascript
module-type: library

Edges between Pinboard cards, drawn as SVG paths ending at card borders.
Parallel edges between the same pair of cards bend apart.

\*/

"use strict";

var Model = require("./model.js");
var Dom = require("./dom.js");

var methods = exports.methods = {};

methods.renderEdges = function() {
	var doc = this.document;
	var layer = this.edgeLayer;
	Dom.clear(layer);
	// Group parallel edges so they can be spread apart.
	var groups = Object.create(null);
	var id, edge;
	for (id in this.edges) {
		edge = this.edges[id];
		if (edge.hidden || !edge.from || !edge.to) {
			continue;
		}
		if (this.filterMatch && (this.isFilteredOut("card", edge.from) || this.isFilteredOut("card", edge.to))) {
			continue;
		}
		var key = edge.from < edge.to ? edge.from + "\n" + edge.to : edge.to + "\n" + edge.from;
		(groups[key] = groups[key] || []).push(id);
	}
	var fragment = doc.createDocumentFragment();
	for (var key in groups) {
		var ids = groups[key];
		for (var i = 0; i < ids.length; i++) {
			edge = this.edges[ids[i]];
			var r1 = this.cardRect(edge.from), r2 = this.cardRect(edge.to);
			if (!r1 || !r2) {
				continue;
			}
			// Offsets are measured in a canonical direction so that
			// A->B and B->A edges bend to opposite sides.
			var offset = (i - (ids.length - 1) / 2) * 46;
			if (edge.from > edge.to) {
				offset = -offset;
			}
			var geometry = edge.from === edge.to ?
				loopGeometry(r1, i) :
				edgeGeometry(r1, r2, offset);
			fragment.appendChild(this.renderEdge(ids[i], edge, geometry));
		}
	}
	layer.appendChild(fragment);
};

methods.renderEdge = function(id, edge, geo) {
	var doc = this.document;
	var width = edge.width !== undefined ? edge.width : 2;
	var color = edge.color || "";
	var selected = this.selection && this.selection.type === "edge" && this.selection.id === id;
	var group = Dom.svg(doc, "g", {"class": "pb-edge" + (selected ? " pb-selected" : ""), "data-pb-edge": id});
	var line = Dom.svg(doc, "path", {"class": "pb-edge-line", d: geo.d, fill: "none"});
	line.style.strokeWidth = width;
	if (color) {
		line.style.stroke = color;
	}
	if (edge.stroke === "dashed") {
		line.style.strokeDasharray = (4 + width * 3) + " " + (3 + width * 2);
	} else if (edge.stroke === "dotted") {
		line.style.strokeDasharray = "0 " + (3 + width * 2);
		line.style.strokeLinecap = "round";
	}
	group.appendChild(Dom.svg(doc, "path", {"class": "pb-edge-hit", d: geo.d, fill: "none"}));
	group.appendChild(line);
	var arrows = edge.arrows;
	if (arrows === undefined || arrows === null) {
		arrows = ["to"];
	} else if (!Array.isArray(arrows)) {
		arrows = [arrows];
	}
	var size = 7 + width * 2;
	var self = this;
	arrows.forEach(function(kind) {
		var at = kind === "to" ? geo.end : (kind === "from" ? geo.start : (kind === "middle" ? geo.mid : null));
		if (at) {
			var head = Dom.svg(doc, "path", {"class": "pb-edge-head", d: arrowHead(at, size)});
			if (color) {
				head.style.fill = color;
			}
			group.appendChild(head);
		}
	});
	if (edge.label) {
		var text = Dom.svg(doc, "text", {
			"class": "pb-edge-label",
			x: Model.round(geo.mid.x),
			y: Model.round(geo.mid.y),
			"text-anchor": "middle",
			"dominant-baseline": "central"
		});
		text.textContent = edge.label;
		group.appendChild(text);
	}
	return group;
};

/*
Returns {d, start, end, mid}; start/end/mid are {x, y, dx, dy} where
(dx, dy) is the direction an arrow at that point should face.
*/
function edgeGeometry(r1, r2, offset) {
	var c1 = {x: r1.x + r1.w / 2, y: r1.y + r1.h / 2};
	var c2 = {x: r2.x + r2.w / 2, y: r2.y + r2.h / 2};
	var dx = c2.x - c1.x, dy = c2.y - c1.y;
	var len = Math.hypot(dx, dy) || 1;
	if (!offset) {
		var s = Model.clipToRect(r1, c2.x, c2.y, 2);
		var e = Model.clipToRect(r2, c1.x, c1.y, 2);
		var ux = (e.x - s.x), uy = (e.y - s.y);
		return {
			d: "M" + r(s.x) + " " + r(s.y) + "L" + r(e.x) + " " + r(e.y),
			start: {x: s.x, y: s.y, dx: -ux, dy: -uy},
			end: {x: e.x, y: e.y, dx: ux, dy: uy},
			mid: {x: (s.x + e.x) / 2, y: (s.y + e.y) / 2, dx: ux, dy: uy}
		};
	}
	// Quadratic curve bent sideways by `offset`.
	var nx = -dy / len, ny = dx / len;
	var cp = {x: (c1.x + c2.x) / 2 + nx * offset * 2, y: (c1.y + c2.y) / 2 + ny * offset * 2};
	var s2 = Model.clipToRect(r1, cp.x, cp.y, 2);
	var e2 = Model.clipToRect(r2, cp.x, cp.y, 2);
	var mid = {
		x: 0.25 * s2.x + 0.5 * cp.x + 0.25 * e2.x,
		y: 0.25 * s2.y + 0.5 * cp.y + 0.25 * e2.y
	};
	return {
		d: "M" + r(s2.x) + " " + r(s2.y) + "Q" + r(cp.x) + " " + r(cp.y) + " " + r(e2.x) + " " + r(e2.y),
		start: {x: s2.x, y: s2.y, dx: s2.x - cp.x, dy: s2.y - cp.y},
		end: {x: e2.x, y: e2.y, dx: e2.x - cp.x, dy: e2.y - cp.y},
		mid: {x: mid.x, y: mid.y, dx: e2.x - s2.x, dy: e2.y - s2.y}
	};
}

function loopGeometry(rect, index) {
	var size = 40 + index * 18;
	var sx = rect.x + rect.w - Math.min(30, rect.w / 3), sy = rect.y;
	var ex = rect.x + rect.w, ey = rect.y + Math.min(24, rect.h / 3);
	var d = "M" + r(sx) + " " + r(sy) +
		"C" + r(sx) + " " + r(sy - size) + " " + r(ex + size) + " " + r(ey) + " " + r(ex) + " " + r(ey);
	return {
		d: d,
		start: {x: sx, y: sy, dx: 0, dy: 1},
		end: {x: ex, y: ey, dx: -1, dy: 0},
		mid: {x: sx + size * 0.55, y: sy - size * 0.55 + 6, dx: 1, dy: 1}
	};
}

function arrowHead(at, size) {
	var len = Math.hypot(at.dx, at.dy) || 1;
	var ux = at.dx / len, uy = at.dy / len;
	var bx = at.x - ux * size, by = at.y - uy * size;
	var px = -uy * size * 0.5, py = ux * size * 0.5;
	return "M" + r(at.x) + " " + r(at.y) +
		"L" + r(bx + px) + " " + r(by + py) +
		"L" + r(bx - px) + " " + r(by - py) + "Z";
}

function r(n) {
	return Math.round(n * 10) / 10;
}
