/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/stories.js
type: application/javascript
module-type: library

Stories: a board can hold several presentation paths. While the path panel
is open, the shown story is drawn on the board as a "red thread": a smooth
line through its stops, with their numbers. A story can be tied to a
tiddler whose `story` field holds the story's cards and chapters in order
(and `pinboard-levels` their outline levels), so the story is an outline
the rest of the wiki can use; both stay in step. A chapter (a frame's own
tiddler) lists the cards lying inside its frame in its `story` field.

\*/

"use strict";

var Model = require("./model.js");
var Dom = require("./dom.js");

var methods = exports.methods = {};

var STORY_TEMPLATE = "$:/plugins/lasjoh-toho/pinboard/templates/story";
var STORY_FIELD = "story";
var SWATCHES = ["#e0503f", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#1f2937"];

/*** The thread on the board ***/

methods.renderPath = function() {
	var layer = this.pathLayer, marks = this.pathMarks, doc = this.document, self = this;
	Dom.clear(layer);
	Dom.clear(marks);
	var show = this.stepsOpen && !this.presenting && !Model.activeStory(this.data).hideThread;
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
	this.storySettingsOpen = true;
	this.focusStoryName = Date.now();
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
The panel's head: which story, whether its thread shows, and a gear for
everything else about it.
*/
methods.renderStoryHead = function(panel) {
	var doc = this.document, self = this;
	var editable = this.isEditable();
	var data = this.data;
	var story = Model.activeStory(data);
	var select = Dom.el(doc, "select", {"class": "pb-story-select", title: "Presentation path: the story shown, played and exported",
		onchange: function() { self.switchStory(select.value); }},
		data.stories.map(function(s) {
			return Dom.el(doc, "option", {value: s.id, text: Model.storyTitle(data, s)});
		}));
	select.value = story.id;
	var hidden = !!story.hideThread;
	var eye = Dom.button(doc, hidden ? "hide" : "eye", hidden ? "Show the thread on the board" : "Hide the thread on the board", function() {
		if (editable) {
			self.setStoryProperty("hideThread", hidden ? undefined : true);
		} else {
			story.hideThread = !hidden;
			self.renderSteps();
			self.renderPath();
		}
	}, "pb-btn-small pb-story-eye" + (hidden ? " pb-off" : ""));
	var gear = Dom.button(doc, "gear", "Story settings", function() {
		self.storySettingsOpen = !self.storySettingsOpen;
		self.renderSteps();
	}, "pb-btn-small" + (this.storySettingsOpen ? " pb-active" : ""));
	panel.appendChild(Dom.el(doc, "div", {"class": "pb-story-row pb-story-head"}, [
		Dom.el(doc, "span", {"class": "pb-story-dot", style: {background: Model.storyColor(story)}}),
		select,
		eye,
		editable ? Dom.button(doc, "plus", "New story", function() { self.addStory(); }, "pb-btn-small") : null,
		gear,
		Dom.button(doc, "close", "Close", function() { self.toggleSteps(false); }, "pb-btn-small")
	]));
	if (this.storySettingsOpen) {
		this.renderStorySettings(panel, story);
	}
	this.renderStoryTiddler(panel, story);
};

/*
The story tiddler, right under the head: its name is free to choose before
it is made (Enter or "Make a story tiddler"), and renaming it later keeps it
tied to the story.
*/
methods.renderStoryTiddler = function(panel, story) {
	var doc = this.document, self = this;
	var editable = this.isEditable();
	var box = Dom.el(doc, "div", {"class": "pb-story-tiddler"});
	if (story.tiddler || (editable && this.graph.store)) {
		// The story tiddler: its name, free to choose before and after it
		// is made.
		// What is typed survives the panel being rebuilt meanwhile.
		var draft = this.storyTiddlerDraft && this.storyTiddlerDraft.id === story.id ? this.storyTiddlerDraft.value : null;
		var tiddlerName = Dom.el(doc, "input", {"class": "pb-input pb-story-tiddler-name", type: "text",
			value: draft !== null ? draft : (story.tiddler || ""), placeholder: this.defaultStoryTiddler(story), readOnly: !editable,
			title: story.tiddler ? "Name of the story tiddler (renaming it keeps it tied to this story)" : "Name for the story tiddler",
			oninput: function() {
				self.storyNameError = null;
				self.storyTiddlerDraft = {id: story.id, value: tiddlerName.value};
			},
			onblur: function() {
				if (self.rebuildingSteps) {
					return;
				}
				var value = tiddlerName.value.trim();
				self.storyTiddlerDraft = null;
				if (story.tiddler && value && value !== story.tiddler) {
					setTimeout(function() { self.renameStoryTiddler(story, value); }, 0);
				}
			},
			onkeydown: function(event) {
				if (event.key === "Enter") {
					if (story.tiddler) {
						tiddlerName.blur();
					} else {
						self.createStoryTiddler(tiddlerName.value.trim());
					}
				}
			}});
		box.appendChild(Dom.el(doc, "label", {"class": "pb-story-field"}, [Dom.el(doc, "span", {text: "Tiddler"}), tiddlerName]));
		if (this.storyNameError) {
			box.appendChild(Dom.el(doc, "div", {"class": "pb-story-error", text: this.storyNameError}));
		}
		if (story.tiddler) {
			box.appendChild(Dom.el(doc, "button", {"class": "pb-story-link", type: "button", title: "Show the story tiddler",
				onclick: function(event) { self.leaveFullscreen(); self.navigate(story.tiddler, event); }}, [Dom.icon(doc, "tiddler"), "Show tiddler"]));
		} else {
			box.appendChild(Dom.el(doc, "button", {"class": "pb-textbtn pb-textbtn-icon", type: "button",
				title: "Keep this story as a tiddler: its story field holds the cards in order, as an outline for the rest of the wiki",
				onclick: function() { self.createStoryTiddler(tiddlerName.value.trim()); }}, [Dom.icon(doc, "tiddler"), "Make a story tiddler"]));
		}
	}
	if (box.firstChild) {
		panel.appendChild(box);
	}
};

/*
The gear's popup: the story's name, its thread, its tiddler, and deleting it.
*/
methods.renderStorySettings = function(panel, story) {
	var doc = this.document, self = this;
	var editable = this.isEditable();
	var data = this.data;
	var popup = Dom.el(doc, "div", {"class": "pb-story-settings"});
	var name = null;
	if (editable) {
		name = Dom.el(doc, "input", {"class": "pb-input pb-story-name", type: "text", placeholder: Model.storyTitle(data, story),
			value: story.title || "", title: "Name of the story",
			onblur: function() {
				if (self.rebuildingSteps) {
					return;
				}
				var value = name.value.trim();
				if (value !== (story.title || "")) {
					// Rebuild the panel after this event, not while the field is
					// still being blurred.
					setTimeout(function() { self.setStoryProperty("title", value); }, 0);
				}
			},
			onkeydown: function(event) {
				if (event.key === "Enter") {
					name.blur();
				}
			}});
		popup.appendChild(Dom.el(doc, "label", {"class": "pb-story-field"}, [Dom.el(doc, "span", {text: "Name"}), name]));
		var color = Dom.el(doc, "input", {type: "color", "class": "pb-story-color", value: Model.storyColor(story), title: "Color of the thread",
			oninput: function() { story.color = color.value; self.renderPath(); },
			onchange: function() { self.setStoryProperty("color", color.value); }});
		var width = Dom.el(doc, "input", {type: "range", "class": "pb-story-width", min: 1, max: 12, step: 1, value: story.width || 3, title: "Thickness of the thread",
			oninput: function() { self.setStoryProperty("width", Number(width.value), true); },
			onchange: function() { self.setStoryProperty("width", Number(width.value)); }});
		popup.appendChild(Dom.el(doc, "div", {"class": "pb-story-field"}, [Dom.el(doc, "span", {text: "Thread"}), color, width]));
	}
	if (editable && data.stories.length > 1) {
		popup.appendChild(Dom.el(doc, "button", {"class": "pb-textbtn pb-textbtn-icon pb-story-delete", type: "button",
			title: "Delete this story (its cards stay on the board)",
			onclick: function() { self.storySettingsOpen = false; self.deleteStory(); }}, [Dom.icon(doc, "trash"), "Delete story"]));
	}
	if (popup.firstChild) {
		panel.appendChild(popup);
	}
	if (name && this.focusStoryName && Date.now() - this.focusStoryName < 1000) {
		// A new story: its name is ready to type, also after the panel is
		// rebuilt while it settles.
		name.focus();
		name.select();
	}
};

/*** The story tiddler ***/

/*
The name a story tiddler gets unless another is chosen: the board's name
and the story's.
*/
methods.defaultStoryTiddler = function(story) {
	var base = Model.storyTitle(this.data, story);
	var board = this.graph.store || "";
	if (board.indexOf("$:/") === 0) {
		// A system tiddler is named by its last part, e.g. "Pinboard Demo".
		board = board.substr(board.lastIndexOf("/") + 1);
	}
	return board ? board + ": " + base : base;
};

methods.createStoryTiddler = function(name) {
	var story = Model.activeStory(this.data);
	this.storyTiddlerDraft = null;
	this.checkpoint();
	story.tiddler = this.wiki.generateNewTitle(name || this.defaultStoryTiddler(story));
	this.syncStoryTiddler(story, true);
	this.commit();
};

/*
Renames the story tiddler; with Relink installed, links to it elsewhere
follow.
*/
methods.renameStoryTiddler = function(story, title) {
	var from = story.tiddler;
	if (!from || !title || title === from) {
		return;
	}
	if (this.wiki.tiddlerExists(title) || this.wiki.isShadowTiddler(title)) {
		this.storyNameError = "\"" + title + "\" already exists.";
		this.renderSteps();
		return;
	}
	this.storyNameError = null;
	if (this.wiki.tiddlerExists(from)) {
		this.wiki.renameTiddler(from, title);
	}
	this.checkpoint();
	story.tiddler = title;
	this.commit();
	if (this.wiki.relinkTiddler) {
		this.wiki.relinkTiddler(from, title);
	}
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
	var entries = Model.storyTiddlers(this.data, story, this.cardCenter.bind(this), this.framedBy(story));
	var levels = entries.map(function(entry) { return String(entry.level); });
	return {
		story: $tw.utils.stringifyList(entries.map(function(entry) { return entry.tiddler; })),
		"pinboard-levels": levels.some(function(l) { return l !== "0"; }) ? levels.join(" ") : ""
	};
};

/*
The cards lying inside a frame: those of `story` in its order, then the
others from top to bottom and left to right.
*/
methods.frameCards = function(shape, story) {
	var self = this, inside = [];
	Object.keys(this.cards).forEach(function(id) {
		var c = self.cardCenter(id);
		if (c && c.x >= shape.x && c.x <= shape.x + shape.w && c.y >= shape.y && c.y <= shape.y + shape.h) {
			inside.push({id: id, x: c.x, y: c.y});
		}
	});
	var rank = Object.create(null);
	Model.stepTitles(this.data, story).forEach(function(title, i) { rank[title] = i; });
	inside.sort(function(a, b) {
		var ra = a.id in rank ? rank[a.id] : Infinity, rb = b.id in rank ? rank[b.id] : Infinity;
		return ra !== rb ? ra - rb : (Math.abs(a.y - b.y) > 20 ? a.y - b.y : a.x - b.x);
	});
	return inside.map(function(entry) { return entry.id; });
};

/*
Writes `fields` to a tiddler of ours if they differ; creates it with
`extra` fields if `create` is set.
*/
methods.writeStoryFields = function(title, fields, create, extra) {
	var existing = this.wiki.getTiddler(title);
	if (!existing && !create) {
		return;
	}
	var same = existing && Object.keys(fields).every(function(key) {
		return existing.getFieldString(key) === (fields[key] || "");
	});
	if (same) {
		return;
	}
	this.storyWrites = this.storyWrites || Object.create(null);
	this.storyWrites[title] = fields[STORY_FIELD];
	var update = {title: title};
	for (var key in fields) {
		update[key] = fields[key] || undefined;
	}
	if (!existing) {
		$tw.utils.extend(update, extra);
	}
	this.wiki.addTiddler(new $tw.Tiddler(
		existing ? null : this.wiki.getCreationFields(),
		existing,
		update,
		this.wiki.getModificationFields()));
};

/*
For Model.storyTiddlers: the cards lying in a frame, for `story`.
*/
methods.framedBy = function(story) {
	var self = this;
	return function(shape) { return self.frameCards(shape, story); };
};

/*
Gives a frame a tiddler of its own, named after its text: a chapter in the
outline of every story it is part of.
*/
methods.makeFrameTiddler = function(shape) {
	if (shape.tiddler) {
		return;
	}
	var name = (shape.text || "").split("\n")[0].trim().substr(0, 80).replace(/[\[\]{}|]/g, "") || "Frame";
	var title = this.wiki.generateNewTitle(name);
	this.wiki.addTiddler(new $tw.Tiddler(this.wiki.getCreationFields(), {
		title: title,
		"pinboard-frame": this.graph.store
	}, this.wiki.getModificationFields()));
	this.checkpoint();
	shape.tiddler = title;
	this.commit();
};

methods.syncStoryTiddler = function(story, create) {
	if (!story.tiddler) {
		return;
	}
	var wanted = this.storyFields(story);
	var existing = this.wiki.getTiddler(story.tiddler);
	if (existing && existing.fields["pinboard-board"] && existing.fields.list !== undefined) {
		// Story tiddlers of version 1.15.0 kept the story in `list`.
		wanted.list = "";
	}
	this.writeStoryFields(story.tiddler, wanted, create, {
		text: "{{||" + STORY_TEMPLATE + "}}",
		"pinboard-board": this.graph.store
	});
};

methods.syncStoryTiddlers = function() {
	var self = this;
	this.data.stories.forEach(function(story) {
		self.syncStoryTiddler(story, false);
	});
	// A frame's tiddler lists the cards inside the frame, in the order of
	// the first story the frame is part of.
	this.data.shapes.forEach(function(shape) {
		if (shape.type !== "frame" || !shape.tiddler) {
			return;
		}
		var story = self.data.stories.filter(function(s) {
			return s.steps.some(function(step) { return step.kind === "frame" && step.ref === shape.id; });
		})[0] || Model.activeStory(self.data);
		self.writeStoryFields(shape.tiddler, {story: $tw.utils.stringifyList(self.frameCards(shape, story))}, false);
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
		var list = tiddler.getFieldString(STORY_FIELD);
		if (self.storyWrites && self.storyWrites[story.tiddler] === list) {
			return;
		}
		if (Model.applyStoryList(self.data, story, $tw.utils.parseStringArray(list) || [], self.framedBy(story))) {
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
	var titles = Model.storyCards(this.data, story, this.cardCenter.bind(this), this.framedBy(story)).filter(function(title) {
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
	this.leaveFullscreen();
	this.navigate(titles[0], event);
};
