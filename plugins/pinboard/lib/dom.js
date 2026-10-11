/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/dom.js
type: application/javascript
module-type: library

Small DOM helpers for the Pinboard engine.

\*/

"use strict";

var SVGNS = "http://www.w3.org/2000/svg";
exports.SVGNS = SVGNS;

/*
el(document, "div", {class: "x", style: {...}, onclick: fn}, [children])
*/
exports.el = function(doc, tag, attrs, children) {
	var node = doc.createElement(tag);
	applyAttributes(node, attrs);
	appendChildren(doc, node, children);
	return node;
};

exports.svg = function(doc, tag, attrs, children) {
	var node = doc.createElementNS(SVGNS, tag);
	applyAttributes(node, attrs);
	appendChildren(doc, node, children);
	return node;
};

exports.setAttrs = applyAttributes;

function applyAttributes(node, attrs) {
	if (!attrs) {
		return;
	}
	for (var name in attrs) {
		var value = attrs[name];
		if (value === undefined || value === null || value === false) {
			if (name !== "style" && name.substr(0, 2) !== "on") {
				node.removeAttribute(name);
			}
		} else if (name === "style" && typeof value === "object") {
			for (var key in value) {
				if (key.substr(0, 2) === "--") {
					node.style.setProperty(key, value[key]);
				} else {
					node.style[key] = value[key];
				}
			}
		} else if (name.substr(0, 2) === "on" && typeof value === "function") {
			node.addEventListener(name.substr(2), value);
		} else if (name === "text") {
			node.textContent = value;
		} else if (name === "html") {
			node.innerHTML = value;
		} else {
			node.setAttribute(name, value === true ? "" : String(value));
		}
	}
}

function appendChildren(doc, node, children) {
	if (!children) {
		return;
	}
	for (var i = 0; i < children.length; i++) {
		var child = children[i];
		if (child === null || child === undefined || child === false) {
			continue;
		}
		if (typeof child === "string") {
			child = doc.createTextNode(child);
		}
		node.appendChild(child);
	}
}

exports.clear = function(node) {
	while (node.firstChild) {
		node.removeChild(node.firstChild);
	}
};

exports.remove = function(node) {
	if (node && node.parentNode) {
		node.parentNode.removeChild(node);
	}
};

exports.closest = function(node, selector, stop) {
	while (node && node !== stop && node.nodeType === 1) {
		if (node.matches && node.matches(selector)) {
			return node;
		}
		node = node.parentNode;
	}
	return null;
};

/*
Elements whose clicks belong to the content, not to the board
(links, form controls, buttons...).
*/
exports.INTERACTIVE = "a, button, input, textarea, select, summary, label, [contenteditable='true'], .tc-tiddlylink, .pb-no-drag";

/*** Icons (24x24 stroke icons) ***/

var ICONS = {
	select: "M5 3l13 7-6 1.5L9 18z",
	hand: "M8 12V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v7c0 4-2.5 7-6.5 7S5 18 4 15l-1.2-3a1.5 1.5 0 012.7-1.2L8 14",
	pen: "M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3",
	highlighter: "M4 20h7M9 15l-3 3 2 2 3-3M9 15l7-11 4 3-8 11z",
	rect: "M4 6h16v12H4z",
	ellipse: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z",
	line: "M5 19L19 5",
	arrow: "M5 19L19 5M10 5h9v9",
	text: "M5 6V4h14v2M12 4v16M9 20h6",
	sticky: "M5 4h14v10l-6 6H5zM13 20v-6h6",
	frame: "M7 3v18M17 3v18M3 7h18M3 17h18",
	eraser: "M8 20h12M5 15l9-9 5 5-8 8H8z",
	card: "M4 5h16v14H4zM4 9h16M8 13h8",
	undo: "M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3",
	redo: "M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3",
	play: "M7 4l13 8-13 8z",
	steps: "M5 6h2M5 12h2M5 18h2M10 6h9M10 12h9M10 18h9",
	plus: "M12 5v14M5 12h14",
	minus: "M5 12h14",
	fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
	close: "M6 6l12 12M18 6L6 18",
	edit: "M4 20l4-1 11-11-3-3L5 16l-1 4z",
	expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
	fields: "M4 6h10M4 12h16M4 18h7M17 4v4M13 16h7",
	trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
	front: "M8 8h12v12H8zM4 4h12v2M4 4v12h2",
	back: "M4 4h12v12H4zM8 18v2h12V8h-2",
	up: "M6 15l6-6 6 6",
	down: "M6 9l6 6 6-6",
	left: "M19 12H5M11 6l-6 6 6 6",
	right: "M5 12h14M13 6l6 6-6 6",
	map: "M3 6.5l6-3 6 3 6-3v14l-6 3-6-3-6 3zM9 3.5v14M15 6.5v14",
	fullscreen: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
	search: "M10.5 4a6.5 6.5 0 110 13 6.5 6.5 0 010-13zM15.5 15.5L20 20",
	palette: "M12 3a9 9 0 100 18c1.2 0 1.6-.9 1.2-1.8-.5-1.1.2-2.2 1.4-2.2H17a4 4 0 004-4c0-5.5-4-10-9-10zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01",
	layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
	link: "M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1",
	nomedia: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M3 3l18 18",
	tiddler: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
	grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
	hide: "M3 3l18 18M10.6 6.2A9.6 9.6 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.2 3.6M6.4 7.6A16.6 16.6 0 002 12s4 6 10 6a9.4 9.4 0 004.2-1",
	open: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
	eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 110 6 3 3 0 010-6z",
	target: "M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 110 8 4 4 0 010-8z"
};

exports.icon = function(doc, name) {
	return exports.svg(doc, "svg", {"class": "pb-icon", viewBox: "0 0 24 24", "aria-hidden": "true"}, [
		exports.svg(doc, "path", {d: ICONS[name] || ICONS.plus})
	]);
};

exports.button = function(doc, iconName, title, onclick, extraClass) {
	return exports.el(doc, "button", {
		"class": "pb-btn" + (extraClass ? " " + extraClass : ""),
		type: "button",
		title: title,
		"aria-label": title,
		onclick: onclick
	}, [exports.icon(doc, iconName)]);
};
