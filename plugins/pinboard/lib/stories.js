/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/stories.js
type: application/javascript
module-type: library

Stories: a board can hold several presentation paths. While the path panel
is open, the shown story is drawn on the board as a "red thread": a smooth
line through its stops, with their numbers. A story can be tied to a
tiddler whose `list` field holds the story's cards in order (and
`pinboard-levels` their outline levels), so the story is an outline the
rest of the wiki can use; both stay in step.

\*/

"use strict";

var Model = require("./model.js");
var Dom = require("./dom.js");

var methods = exports.methods = {};

var STORY_TEMPLATE = "$:/plugins/lasjoh-toho/pinboard/templates/story";
var SWATCHES = ["#e0503f", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#1f2937"];

/*** The thread on the board ***/

methods.renderPath = function() {
	var layer = this.pathLayer, marks = this.pathMarks, doc = this.document, self = this;
	Dom.clear(layer);
	Dom.clear(marks);
	var show = this.stepsOpen && !this.presenting;
	var inStory = Object.create(null);
	if (show) {
		var story = Model.activeStory(this.data);
		var color = Model.storyColor(story);
		var width = story.width || 3;
		var points = [];
		story.steps.forEach(function(step, index) {
			var target = self.stepTarget(step);
			if (!target) {
				return;
			}
			if (step.kind === "card") {
				inStory[step.ref] = true;
			}
			var r = target.rect;
			points.push({x: r.x + r.w / 2, y: r.y + r.h / 2, index: index, rect: r, step: step});
		});
		if (points.length > 1) {
			layer.appendChild(Dom.svg(doc, "path", {
				"class": "pb-thread-line",
				d: Model.threadPath(points),
				style: {stroke: color, strokeWidth: width}
			}));
		}
		points.forEach(function(point) {
			// The number sits on the top left corner of its stop.
			var x = point.step.kind === "view" ? point.x : point.rect.x;
			var y = point.step.kind === "view" ? point.y : point.rect.y;
			var mark = Dom.svg(doc, "g", {
				"class": "pb-thread-mark",
				style: {transform: "translate(" + x + "px," + y + "px) scale(var(--pb-inv))"}
			}, [
				Dom.svg(doc, "circle", {r: 11, style: {fill: color}}),
				Dom.svg(doc, "text", {"text-anchor": "middle", "dominant-baseline": "central", text: String(point.index + 1)})
			]);
			marks.appendChild(mark);
		});
		this.root.style.setProperty("--pb-story-color", color);
	}
	for (var id in this.cards) {
		$tw.utils.toggleClass(this.cards[id].el, "pb-in-story", !!inStory[id]);
	}
};

/*** Choosing and editing stories ***/

methods.switchStory = function(id) {
	if (id === this.data.story || !Model.findStory(this.data, id)) {
		return;
	}
	this.checkpoint();
	this.data.story = id;
	this.commit();
};

methods.addStory = function() {
	this.checkpoint();
	var story = Model.newStory(null, "Story " + (this.data.stories.length + 1));
	story.color = SWATCHES[this.data.stories.length % SWATCHES.length];
	this.data.stories.push(story);
	this.data.story = story.id;
	this.commit();
	this.toggleSteps(true);
};

methods.deleteStory = function() {
	if (this.data.stories.length < 2) {
		return;
	}
	this.checkpoint();
	var story = Model.activeStory(this.data);
	var index = this.data.stories.indexOf(story);
	this.data.stories.splice(index, 1);
	this.data.story = this.data.stories[Math.max(0, index - 1)].id;
	this.commit();
};

methods.setStoryProperty = function(key, value, live) {
	var story = Model.activeStory(this.data);
	if (!live && !this.storyEditing) {
		this.checkpoint();
	}
	if (value === undefined || value === "") {
		delete story[key];
	} else {
		story[key] = value;
	}
	if (live) {
		// Only redraw while the slider or color picker moves.
		this.storyEditing = true;
		this.renderPath();
	} else {
		this.storyEditing = false;
		this.commit();
	}
};

methods.indentStep = function(index, by) {
	var steps = this.data.steps;
	this.checkpoint();
	if (Model.indentStep(steps, index, by)) {
		this.commit();
	} else {
		this.undoStack.pop();
	}
};

/*
The panel's head: which story, its name and color, and its tiddler.
*/
methods.renderStoryHead = function(panel) {
	var doc = this.document, self = this;
	var editable = this.isEditable();
	var data = this.data;
	var story = Model.activeStory(data);
	var select = Dom.el(doc, "select", {"class": "pb-story-select", title: "Story shown, played and exported",
		onchange: function() { self.switchStory(select.value); }},
		data.stories.map(function(s) {
			return Dom.el(doc, "option", {value: s.id, text: Model.storyTitle(data, s)});
		}));
	select.value = story.id;
	panel.appendChild(Dom.el(doc, "div", {"class": "pb-story-row"}, [
		Dom.el(doc, "span", {"class": "pb-story-dot", style: {background: Model.storyColor(story)}}),
		select,
		editable ? Dom.button(doc, "plus", "New story", function() { self.addStory(); }, "pb-btn-small") : null,
		editable && data.stories.length > 1 ? Dom.button(doc, "trash", "Delete this story", function() { self.deleteStory(); }, "pb-btn-small") : null
	]));
	if (editable) {
		var name = Dom.el(doc, "input", {"class": "pb-input pb-story-name", type: "text", placeholder: Model.storyTitle(data, story),
			value: story.title || "", title: "Name of the story",
			onchange: function() { self.setStoryProperty("title", name.value.trim()); }});
		var color = Dom.el(doc, "input", {type: "color", "class": "pb-story-color", value: Model.storyColor(story), title: "Color of the thread",
			oninput: function() { story.color = color.value; self.renderPath(); },
			onchange: function() { self.setStoryProperty("color", color.value); }});
		var width = Dom.el(doc, "input", {type: "range", "class": "pb-story-width", min: 1, max: 12, step: 1, value: story.width || 3, title: "Thickness of the thread",
			oninput: function() { self.setStoryProperty("width", Number(width.value), true); },
			onchange: function() { self.setStoryProperty("width", Number(width.value)); }});
		panel.appendChild(Dom.el(doc, "div", {"class": "pb-story-row"}, [name, color, width]));
	}
	var tiddlerRow = Dom.el(doc, "div", {"class": "pb-story-row pb-story-tiddler"});
	if (story.tiddler) {
		tiddlerRow.appendChild(Dom.el(doc, "button", {"class": "pb-textbtn pb-textbtn-icon", type: "button",
			title: "Open the story's cards in order in the story river",
			onclick: function(event) { self.openStory(event); }}, [Dom.icon(doc, "open"), "Open story"]));
		tiddlerRow.appendChild(Dom.el(doc, "button", {"class": "pb-story-link", type: "button", title: "Show the story tiddler",
			onclick: function(event) { self.navigate(story.tiddler, event); }}, [Dom.icon(doc, "tiddler"), story.tiddler]));
	} else if (editable && this.graph.store) {
		tiddlerRow.appendChild(Dom.el(doc, "button", {"class": "pb-textbtn pb-textbtn-icon", type: "button",
			title: "Keep this story as a tiddler: its list field holds the cards in order, as an outline for the rest of the wiki",
			onclick: function() { self.createStoryTiddler(); }}, [Dom.icon(doc, "tiddler"), "Make a story tiddler"]));
	}
	if (tiddlerRow.firstChild) {
		panel.appendChild(tiddlerRow);
	}
};

/*** The story tiddler ***/

methods.createStoryTiddler = function() {
	var story = Model.activeStory(this.data);
	var base = Model.storyTitle(this.data, story);
	var board = this.graph.store || "";
	if (board.indexOf("$:/") === 0) {
		// A system tiddler is named by its last part, e.g. "Pinboard Demo".
		board = board.substr(board.lastIndexOf("/") + 1);
	}
	if (board) {
		base = board + ": " + base;
	}
	this.checkpoint();
	story.tiddler = this.wiki.generateNewTitle(base);
	this.syncStoryTiddler(story, true);
	this.commit();
};

methods.cardCenter = function(id) {
	var rect = this.cardRect(id);
	return rect ? {x: rect.x + rect.w / 2, y: rect.y + rect.h / 2} : null;
};

/*
The outline of the shown story, one entry per step ({tiddler, level}).
*/
methods.storyOutline = function() {
	return Model.storyOutline(this.data, Model.activeStory(this.data), this.cardCenter.bind(this));
};

/*
What the story tiddler should say: its cards and chapters in order, and
their levels.
*/
methods.storyFields = function(story) {
	var entries = Model.storyTiddlers(this.data, story, this.cardCenter.bind(this));
	var levels = entries.map(function(entry) { return String(entry.level); });
	return {
		list: $tw.utils.stringifyList(entries.map(function(entry) { return entry.tiddler; })),
		"pinboard-levels": levels.some(function(l) { return l !== "0"; }) ? levels.join(" ") : ""
	};
};

/*
Every frame in a story that has a story tiddler becomes a chapter: it gets
a tiddler of its own, named after the frame's text. Returns true if any
frame got one.
*/
methods.ensureFrameTiddlers = function() {
	var self = this, made = false;
	var used = Object.create(null);
	this.data.shapes.forEach(function(shape) {
		if (shape.tiddler) {
			used[shape.tiddler] = true;
		}
	});
	this.data.stories.forEach(function(story) {
		if (!story.tiddler) {
			return;
		}
		story.steps.forEach(function(step) {
			var shape = step.kind === "frame" && Model.findShape(self.data, step.ref);
			if (!shape || shape.tiddler) {
				return;
			}
			var name = (shape.text || "").split("\n")[0].trim() || "Frame";
			var title = self.wiki.generateNewTitle(name);
			var old = self.wiki.getTiddler(name);
			if (old && old.fields["pinboard-frame"] === self.graph.store && !used[name]) {
				// This frame's chapter from before (e.g. after an undo).
				title = name;
			} else {
				self.wiki.addTiddler(new $tw.Tiddler(self.wiki.getCreationFields(), {
					title: title,
					"pinboard-frame": self.graph.store
				}, self.wiki.getModificationFields()));
			}
			shape.tiddler = title;
			used[title] = true;
			made = true;
		});
	});
	return made;
};

methods.syncStoryTiddler = function(story, create) {
	if (!story.tiddler) {
		return;
	}
	if (create) {
		this.ensureFrameTiddlers();
	}
	var wanted = this.storyFields(story);
	var existing = this.wiki.getTiddler(story.tiddler);
	if (!existing && !create) {
		return;
	}
	if (existing && existing.getFieldString("list") === wanted.list &&
		existing.getFieldString("pinboard-levels") === wanted["pinboard-levels"]) {
		return;
	}
	this.storyWrites = this.storyWrites || Object.create(null);
	this.storyWrites[story.tiddler] = wanted.list;
	var fields = {title: story.tiddler, list: wanted.list, "pinboard-levels": wanted["pinboard-levels"] || undefined};
	if (!existing) {
		fields.text = "{{||" + STORY_TEMPLATE + "}}";
		fields["pinboard-board"] = this.graph.store;
	}
	this.wiki.addTiddler(new $tw.Tiddler(
		existing ? null : this.wiki.getCreationFields(),
		existing,
		fields,
		this.wiki.getModificationFields()));
};

methods.syncStoryTiddlers = function() {
	var self = this;
	this.data.stories.forEach(function(story) {
		self.syncStoryTiddler(story, false);
	});
};

/*
A story tiddler's list was changed elsewhere in the wiki: the story follows.
Returns true if the board's data changed.
*/
methods.readStoryTiddlers = function(changes) {
	var changed = false, self = this;
	this.data.stories.forEach(function(story) {
		if (!story.tiddler || !changes[story.tiddler]) {
			return;
		}
		var tiddler = self.wiki.getTiddler(story.tiddler);
		if (!tiddler) {
			return;
		}
		var list = tiddler.getFieldString("list");
		if (self.storyWrites && self.storyWrites[story.tiddler] === list) {
			return;
		}
		if (Model.applyStoryList(self.data, story, $tw.utils.parseStringArray(list) || [])) {
			changed = true;
		}
	});
	return changed;
};

/*
Puts the story's cards into the story river, in order, ahead of what is
already open, and scrolls to the first one.
*/
methods.openStory = function(event) {
	var story = Model.activeStory(this.data);
	var titles = Model.storyCards(this.data, story).filter(function(title) {
		return !!this.wiki.getTiddler(title) || this.wiki.isShadowTiddler(title);
	}, this);
	if (story.tiddler) {
		titles.unshift(story.tiddler);
	}
	if (!titles.length) {
		return;
	}
	var listTitle = (this.parentWidget.getVariable && this.parentWidget.getVariable("tv-story-list")) || "$:/StoryList";
	var current = this.wiki.getTiddlerList(listTitle).filter(function(title) {
		return titles.indexOf(title) < 0;
	});
	var existing = this.wiki.getTiddler(listTitle);
	this.wiki.addTiddler(new $tw.Tiddler(existing, {title: listTitle, list: titles.concat(current)}));
	this.navigate(titles[0], event);
};
