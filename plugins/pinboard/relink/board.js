/*\
title: $:/plugins/lasjoh-toho/pinboard/relink/board.js
type: application/javascript
module-type: relinkoperator

With Relink installed, renaming a tiddler also renames it on every board:
its card, its stops in the stories, and story, frame and picture tiddlers
named in the board's `pinboard` field.

\*/

"use strict";

exports.name = "pinboard";

var FIELD = "pinboard";

function parse(tiddler) {
	var text = tiddler.fields[FIELD];
	if (!text) {
		return null;
	}
	try {
		var data = JSON.parse(text);
		return data && typeof data === "object" ? data : null;
	} catch (e) {
		return null;
	}
}

function stepLists(data) {
	var lists = [];
	if (Array.isArray(data.steps)) {
		lists.push(data.steps);
	}
	(Array.isArray(data.stories) ? data.stories : []).forEach(function(story) {
		if (story && Array.isArray(story.steps)) {
			lists.push(story.steps);
		}
	});
	return lists;
}

/*
Calls fn(title, blurb, set) for each tiddler the board names; set(newTitle)
renames it in `data`.
*/
function eachTitle(data, fn) {
	if (data.cards && typeof data.cards === "object") {
		Object.keys(data.cards).forEach(function(title) {
			fn(title, "card", function(to) {
				var cards = {};
				Object.keys(data.cards).forEach(function(key) {
					if (key === title) {
						if (!(to in data.cards)) {
							cards[to] = data.cards[key];
						}
					} else {
						cards[key] = data.cards[key];
					}
				});
				data.cards = cards;
			});
		});
	}
	stepLists(data).forEach(function(steps) {
		steps.forEach(function(step) {
			if (step && step.kind === "card" && typeof step.ref === "string") {
				fn(step.ref, "stop", function(to) { step.ref = to; });
			}
		});
	});
	(Array.isArray(data.stories) ? data.stories : []).forEach(function(story) {
		if (story && typeof story.tiddler === "string") {
			fn(story.tiddler, "story tiddler", function(to) { story.tiddler = to; });
		}
	});
	(Array.isArray(data.shapes) ? data.shapes : []).forEach(function(shape) {
		if (shape && typeof shape.tiddler === "string") {
			fn(shape.tiddler, "frame tiddler", function(to) { shape.tiddler = to; });
		}
	});
	var bg = data.background;
	if (bg && typeof bg.image === "string" && bg.image) {
		fn(bg.image, "picture", function(to) { bg.image = to; });
	}
}

exports.report = function(tiddler, callback, options) {
	var data = parse(tiddler);
	if (data) {
		eachTitle(data, function(title, blurb) {
			callback(title, FIELD + ": " + blurb);
		});
	}
};

exports.relink = function(tiddler, fromTitle, toTitle, changes, options) {
	var data = parse(tiddler);
	if (!data) {
		return;
	}
	var setters = [];
	eachTitle(data, function(title, blurb, set) {
		if (title === fromTitle) {
			setters.push(set);
		}
	});
	if (setters.length) {
		setters.forEach(function(set) { set(toTitle); });
		changes[FIELD] = {output: JSON.stringify(data)};
	}
};
