/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/cards.js
type: application/javascript
module-type: library

Cards: the Pinboard's nodes. Each card renders the chosen fields of its
tiddler through a TiddlyWiki widget tree, so links, transclusions and
images inside it behave like anywhere else in the wiki.

\*/

"use strict";

var Model = require("./model.js");
var Dom = require("./dom.js");

var TEMPLATE = "$:/plugins/lasjoh-toho/pinboard/templates/card";
var DEFAULT_WIDTH = 240;
// Cards the presentation shows in a fuller version get at least this wide.
var PRESENT_WIDTH = 520;

var methods = exports.methods = {};

methods.hasPropPosition = function(id) {
	var node = this.nodes[id];
	return !!(node && node.x !== undefined && node.x !== null && node.y !== undefined && node.y !== null);
};

methods.cardFields = function(id) {
	var stored = this.data.cards[id];
	var node = this.nodes[id] || {};
	return Model.resolveFields(stored ? stored.fields : undefined, node.fields, this.graph.fields);
};

var TEXT_MODES = ["full", "break", "image", "imagebreak"];
exports.TEXT_MODES = TEXT_MODES;

/*
How a card shows its text on the board and when the presentation focuses
it: the per-card choice, else the graph's default. "same" (or nothing)
for the presentation means: as on the board.
*/
methods.cardTextModes = function(id) {
	var stored = this.data.cards[id] || {};
	var board = stored.textMode || this.graph.textMode || "full";
	var present = stored.presentMode || this.graph.presentTextMode || "same";
	if (TEXT_MODES.indexOf(board) < 0) {
		board = "full";
	}
	if (TEXT_MODES.indexOf(present) < 0) {
		present = board;
	}
	return {board: board, present: present};
};

methods.syncCard = function(id) {
	var node = this.nodes[id];
	if (!node) {
		return;
	}
	var card = this.cards[id] || this.createCard(id);
	var stored = this.data.cards[id] || {};
	var doc = this.document;
	// Position
	if (this.hasPropPosition(id)) {
		var key = node.x + "," + node.y;
		if (card.propPosKey !== key) {
			card.propPosKey = key;
			card.pos = {x: node.x, y: node.y};
		}
	} else {
		card.propPosKey = null;
		if (!card.pos) {
			if (stored.x !== undefined && stored.y !== undefined) {
				card.pos = {x: stored.x, y: stored.y};
			} else if (this.pendingPosition && Date.now() - this.pendingPosition.time < 15000
				&& (!this.pendingPosition.title || this.pendingPosition.title === id)) {
				card.pos = {x: this.pendingPosition.x, y: this.pendingPosition.y};
				this.pendingPosition = null;
				this.persistCardPosition(id, true);
			} else {
				card.pos = null;
			}
		}
	}
	// Size
	card.w = stored.w || node.width || this.graph.cardWidth || DEFAULT_WIDTH;
	card.fixedH = stored.h || node.height || 0;
	card.el.style.width = card.w + "px";
	card.el.style.height = card.fixedH ? card.fixedH + "px" : "";
	$tw.utils.toggleClass(card.el, "pb-card-fixed", !!card.fixedH);
	card.el.style.display = node.hidden ? "none" : "";
	// Header
	var color = node.color || "";
	card.el.style.setProperty("--pb-card-color", color || "");
	card.el.style.setProperty("--pb-card-ink", Model.contrastColor(color) || "");
	card.label.textContent = node.label || id;
	card.el.title = "";
	if (node.image) {
		if (!card.icon) {
			card.icon = Dom.el(doc, "img", {"class": "pb-card-icon", alt: "", draggable: "false"});
			card.head.insertBefore(card.icon, card.label);
		}
		if (card.icon.getAttribute("src") !== node.image) {
			card.icon.setAttribute("src", node.image);
		}
	} else if (card.icon) {
		Dom.remove(card.icon);
		card.icon = null;
	}
	// Body
	var fields = this.cardFields(id);
	var showTitle = fields.indexOf("title") >= 0 || fields.length === 0;
	var bodyFields = fields.filter(function(f) { return f !== "title"; });
	$tw.utils.toggleClass(card.el, "pb-card-notitle", !showTitle);
	$tw.utils.toggleClass(card.el, "pb-card-nobody", bodyFields.length === 0);
	var template = node.template || this.graph.cardTemplate || TEMPLATE;
	var modes = this.cardTextModes(id);
	var hasPresent = modes.present !== modes.board && bodyFields.indexOf("text") >= 0;
	var renderKey = [template, modes.board, hasPresent ? modes.present : ""].concat(bodyFields).join("\n");
	if (card.renderKey !== renderKey) {
		card.renderKey = renderKey;
		card.widget = this.renderCardBody(card.body, card.widget, card.id, template, bodyFields, modes.board);
		card.presentWidget = this.renderCardBody(card.present, card.presentWidget, card.id, template, hasPresent ? bodyFields : [], modes.present);
	}
	$tw.utils.toggleClass(card.el, "pb-has-present", hasPresent);
	card.el.style.setProperty("--pb-present-w", Math.max(card.w, PRESENT_WIDTH) + "px");
	card.el.style.setProperty("--pb-present-shift", ((card.w - Math.max(card.w, PRESENT_WIDTH)) / 2) + "px");
	// Tools
	var editable = this.isEditable();
	card.deleteBtn.style.display = this.can("nodes", id, "delete") ? "" : "none";
	card.fieldsBtn.style.display = editable ? "" : "none";
	card.stepBtn.style.display = editable ? "" : "none";
	card.effectsBtn.style.display = editable ? "" : "none";
	$tw.utils.toggleClass(card.effectsBtn, "pb-active", !!(stored.build || stored.exit));
	card.resize.style.display = editable ? "" : "none";
	card.connector.style.display = editable && this.can("graph", null, "addEdge") ? "" : "none";
	card.linkBtn.style.display = editable && this.can("graph", null, "addEdge") ? "" : "none";
	if (this.chooser && this.chooser.id === id) {
		this.renderChooser();
	}
};

methods.createCard = function(id) {
	var doc = this.document, self = this;
	var card = {id: id};
	card.label = Dom.el(doc, "span", {"class": "pb-card-label"});
	card.head = Dom.el(doc, "div", {"class": "pb-card-head"}, [card.label]);
	card.body = Dom.el(doc, "div", {"class": "pb-card-body"});
	card.present = Dom.el(doc, "div", {"class": "pb-card-body pb-card-present"});
	card.deleteBtn = Dom.button(doc, "trash", "Remove from board", function(e) {
		self.fire("nodes", id, "delete", e);
	});
	card.fieldsBtn = Dom.button(doc, "fields", "Choose shown fields", function(e) {
		self.openChooser(id);
	});
	card.linkBtn = Dom.button(doc, "link", "Link to another card (then click the other card)", function() {
		self.startLinking(id);
	});
	card.stepBtn = Dom.button(doc, "target", "Add to presentation path", function() {
		self.addStep({kind: "card", ref: id});
	});
	card.effectsBtn = Dom.button(doc, "eye", "Appear / disappear during the presentation", function() {
		self.openEffects("c:" + id);
	});
	card.tools = Dom.el(doc, "div", {"class": "pb-card-tools pb-chrome"}, [
		Dom.button(doc, "expand", "View tiddler", function() { self.openModal(id); }),
		card.fieldsBtn,
		card.linkBtn,
		card.stepBtn,
		card.effectsBtn,
		card.deleteBtn
	]);
	card.resize = Dom.el(doc, "div", {"class": "pb-card-resize", "data-pb-card-part": "resize", title: "Resize"});
	card.connector = Dom.el(doc, "div", {"class": "pb-card-connector", "data-pb-card-part": "connect", title: "Drag to another card to connect"});
	card.el = Dom.el(doc, "div", {"class": "pb-card", "data-pb-id": id}, [
		card.head, card.body, card.present, card.tools, card.resize, card.connector
	]);
	this.cardLayer.appendChild(card.el);
	this.cards[id] = card;
	return card;
};

/*
Renders the card template into `container`, replacing what was there.
Returns the new widget tree (or null when there is nothing to show).
*/
methods.renderCardBody = function(container, oldWidget, id, template, fields, textMode) {
	if (oldWidget) {
		Dom.clear(container);
	}
	if (fields.length === 0) {
		return null;
	}
	var enclosing = this.enclosingTiddlers();
	var widget = this.wiki.makeTranscludeWidget(template, {
		document: this.document,
		parentWidget: this.parentWidget,
		importPageMacros: true,
		mode: "block",
		variables: {
			currentTiddler: id,
			"pinboard-fields": $tw.utils.stringifyList(fields),
			"pinboard-text-mode": textMode,
			// A card must not render a board it is already part of.
			"pinboard-enclosing": $tw.utils.stringifyList(enclosing.concat([id])),
			"pinboard-recursive": enclosing.indexOf(id) >= 0 ? "yes" : "no"
		}
	});
	widget.render(container, null);
	return widget;
};

/*
Tiddlers this board lives in: its store, the tiddler showing it, and the
cards of any boards around it.
*/
methods.enclosingTiddlers = function() {
	var parent = this.parentWidget;
	var get = function(name) {
		return (parent && parent.getVariable) ? parent.getVariable(name) : undefined;
	};
	var list = $tw.utils.parseStringArray(get("pinboard-enclosing") || "") || [];
	[this.graph.store, get("storyTiddler")].forEach(function(title) {
		if (title && list.indexOf(title) < 0) {
			list.push(title);
		}
	});
	return list;
};

methods.refreshCards = function(changes) {
	for (var id in this.cards) {
		var card = this.cards[id];
		card.widget && card.widget.refresh(changes);
		card.presentWidget && card.presentWidget.refresh(changes);
	}
	if (this.chooser && changes[this.chooser.id]) {
		this.renderChooser();
	}
};

methods.removeCard = function(id) {
	var card = this.cards[id];
	if (!card) {
		return;
	}
	Dom.clear(card.body);
	Dom.clear(card.present);
	Dom.remove(card.el);
	delete this.cards[id];
	if (this.selection && this.selection.type === "card" && this.selection.id === id) {
		this.selection = null;
	}
	if (this.chooser && this.chooser.id === id) {
		this.closeChooser();
	}
};

methods.navigate = function(id, event) {
	var bounds = this.root.getBoundingClientRect();
	this.parentWidget.dispatchEvent({
		type: "tm-navigate",
		navigateTo: id,
		navigateFromTitle: this.parentWidget.getVariable ? this.parentWidget.getVariable("currentTiddler") : undefined,
		navigateFromNode: this.root,
		navigateFromClientRect: {top: bounds.top, left: bounds.left, width: bounds.width, right: bounds.right, bottom: bounds.bottom, height: bounds.height},
		navigateSuppressNavigation: event && (event.metaKey || event.ctrlKey || (event.button === 1)),
		event: event
	});
};

/*
Cards without a position get one on a grid around the origin, skipping
cells already covered by positioned cards.
*/
methods.autoPlaceCards = function() {
	var occupied = [];
	var pending = [];
	for (var id in this.cards) {
		var card = this.cards[id];
		if (card.pos) {
			var r = this.cardRect(id);
			r && occupied.push(r);
		} else if (this.nodes[id] && !this.nodes[id].hidden) {
			pending.push(id);
		}
	}
	if (pending.length === 0) {
		return;
	}
	var columns = Math.max(3, Math.ceil(Math.sqrt(pending.length + occupied.length)));
	var cellW = (this.graph.cardWidth || DEFAULT_WIDTH) + 60, cellH = 220;
	var cell = 0;
	for (var i = 0; i < pending.length; i++) {
		var pid = pending[i];
		var pos;
		do {
			pos = {x: (cell % columns) * cellW, y: Math.floor(cell / columns) * cellH};
			cell++;
		} while (overlapsAny({x: pos.x - cellW / 2, y: pos.y - cellH / 2, w: cellW, h: cellH}, occupied) && cell < 10000);
		this.cards[pid].pos = pos;
		this.cards[pid].autoPlaced = true;
	}
};

function overlapsAny(rect, rects) {
	for (var i = 0; i < rects.length; i++) {
		var r = rects[i];
		if (rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y) {
			return true;
		}
	}
	return false;
}

methods.layoutCards = function() {
	this.autoPlaceCards();
	for (var id in this.cards) {
		this.layoutCard(id);
	}
};

methods.layoutCard = function(id) {
	var card = this.cards[id];
	if (!card || !card.pos) {
		return;
	}
	var h = card.fixedH || card.el.offsetHeight || 40;
	card.h = h;
	card.el.style.left = (card.pos.x - card.w / 2) + "px";
	card.el.style.top = (card.pos.y - h / 2) + "px";
};

methods.cardRect = function(id) {
	var card = this.cards[id];
	var node = this.nodes[id];
	if (!card || !card.pos || !node || node.hidden) {
		return null;
	}
	var h = card.h || card.fixedH || 40;
	return {x: card.pos.x - card.w / 2, y: card.pos.y - h / 2, w: card.w, h: h};
};

/*
The rectangle a card takes when the presentation stops at it: wider and
as tall as its presentation text, when it has one (pb-has-present).
*/
methods.presentRect = function(id) {
	var rect = this.cardRect(id);
	var card = this.cards[id];
	if (!rect || !card.el.classList.contains("pb-has-present")) {
		return rect;
	}
	card.el.classList.add("pb-measure-present");
	var w = card.el.offsetWidth, h = card.el.offsetHeight;
	card.el.classList.remove("pb-measure-present");
	return {x: card.pos.x - w / 2, y: rect.y, w: w, h: h};
};

/*
Records a card's position: through the node's "free" actions when the
graph defines them (so TW5-Graph stores it the usual way), otherwise on
the board itself.
*/
methods.persistCardPosition = function(id, deferred) {
	var card = this.cards[id];
	if (!card || !card.pos) {
		return;
	}
	var x = Model.round(card.pos.x), y = Model.round(card.pos.y);
	card.pos = {x: x, y: y};
	card.autoPlaced = false;
	if (this.can("nodes", id, "free")) {
		var self = this;
		var fire = function() { self.fire("nodes", id, "free", null, {x: x, y: y}); };
		deferred ? setTimeout(fire, 0) : fire();
	} else {
		var stored = this.data.cards[id] = this.data.cards[id] || {};
		stored.x = x;
		stored.y = y;
		if (deferred) {
			var self = this;
			setTimeout(function() { !self.destroyed && self.commit(); }, 0);
		} else {
			this.commit();
		}
	}
};

/*** Linking: the card's link button, then a click on another card ***/

methods.startLinking = function(id) {
	this.closeChooser();
	this.linking = {from: id};
	this.root.classList.add("pb-linking");
	this.showHint("Click the card to link \u201c" + (this.nodes[id] && this.nodes[id].label || id) + "\u201d to \u2014 Esc cancels");
};

methods.stopLinking = function() {
	if (this.linking) {
		this.linking = null;
		this.root.classList.remove("pb-linking");
		this.showHint(null);
	}
};

methods.showHint = function(text) {
	if (!this.hint) {
		this.hint = Dom.el(this.document, "div", {"class": "pb-hint pb-chrome"});
		this.root.appendChild(this.hint);
	}
	this.hint.textContent = text || "";
	this.hint.style.display = text ? "" : "none";
};

/*** Card gestures ***/

methods.startCardDrag = function(start, id) {
	var card = this.cards[id];
	if (!card || !card.pos) {
		return null;
	}
	this.select({type: "card", id: id});
	var origin = {x: card.pos.x, y: card.pos.y};
	return {
		kind: "card",
		start: start,
		onStart: function(g) {
			this.fire("nodes", id, "drag", start.event);
			card.el.classList.add("pb-dragging");
			if (!this.can("nodes", id, "free")) {
				this.checkpoint();
			}
		},
		onMove: function(g, world) {
			card.pos = {x: origin.x + world.x - start.world.x, y: origin.y + world.y - start.world.y};
			this.layoutCard(id);
			this.renderEdges();
		},
		onEnd: function(g, world, event) {
			card.el.classList.remove("pb-dragging");
			this.persistCardPosition(id);
		},
		onClick: function() {
			var target = start.event.target;
			if (Dom.closest(target, "[data-pb-more]", card.el)) {
				this.openModal(id);
			} else if (target.tagName === "IMG" && Dom.closest(target, ".pb-card-body", card.el)) {
				this.openLightbox(target.currentSrc || target.src, target.alt);
			}
		},
		onCancel: function() {
			card.el.classList.remove("pb-dragging");
			card.pos = origin;
			this.layoutCard(id);
			this.renderEdges();
		}
	};
};

methods.startCardPartGesture = function(start, id, part) {
	var card = this.cards[id];
	if (!card || !card.pos) {
		return null;
	}
	if (part === "resize") {
		var rect = this.cardRect(id);
		return {
			kind: "card-resize",
			start: start,
			capture: true,
			onStart: function() { this.checkpoint(); },
			onMove: function(g, world) {
				// Resize from the bottom-right corner, keeping the top-left fixed.
				card.w = Math.max(60, rect.w + world.x - start.world.x);
				card.fixedH = Math.max(36, rect.h + world.y - start.world.y);
				card.pos = {x: rect.x + card.w / 2, y: rect.y + card.fixedH / 2};
				card.el.style.width = card.w + "px";
				card.el.style.height = card.fixedH + "px";
				card.el.classList.add("pb-card-fixed");
				this.layoutCard(id);
				this.renderEdges();
			},
			onEnd: function() {
				var stored = this.data.cards[id] = this.data.cards[id] || {};
				stored.w = Math.round(card.w);
				stored.h = Math.round(card.fixedH);
				this.persistCardPosition(id);
				this.commit();
			}
		};
	}
	if (part === "connect") {
		var doc = this.document;
		var line = Dom.svg(doc, "line", {"class": "pb-connect-line"});
		return {
			kind: "connect",
			start: start,
			capture: true,
			alwaysEnd: true,
			onStart: function() { this.uiLayer.appendChild(line); },
			onMove: function(g, world) {
				Dom.setAttrs(line, {x1: card.pos.x, y1: card.pos.y, x2: world.x, y2: world.y});
			},
			onEnd: function(g, world, event) {
				Dom.remove(line);
				var hit = this.document.elementFromPoint(event.clientX, event.clientY);
				var other = Dom.closest(hit, ".pb-card", this.viewport);
				var toId = other && other.getAttribute("data-pb-id");
				if (toId) {
					this.fire("graph", null, "addEdge", event, {fromTiddler: id, toTiddler: toId});
				}
			},
			onCancel: function() { Dom.remove(line); }
		};
	}
	return null;
};

/*** Field chooser ***/

methods.openChooser = function(id) {
	this.closeChooser();
	this.closeEffects && this.closeEffects();
	this.chooser = {id: id, el: Dom.el(this.document, "div", {"class": "pb-popup pb-chooser pb-chrome"})};
	this.root.appendChild(this.chooser.el);
	this.renderChooser();
	this.positionPopups();
};

methods.closeChooser = function() {
	if (this.chooser) {
		Dom.remove(this.chooser.el);
		this.chooser = null;
	}
};

methods.renderChooser = function() {
	var self = this, doc = this.document;
	var id = this.chooser.id;
	var el = this.chooser.el;
	var tiddler = this.wiki.getTiddler(id);
	var available = tiddler ? Object.keys(tiddler.fields) : ["title"];
	var chosen = this.cardFields(id);
	var stored = this.data.cards[id];
	var custom = !!(stored && typeof stored.fields === "string");
	var list = Model.chooserFields(available, chosen);
	var setFields = function(fields) {
		self.checkpoint();
		var entry = self.data.cards[id] = self.data.cards[id] || {};
		if (fields === null) {
			delete entry.fields;
		} else {
			entry.fields = $tw.utils.stringifyList(fields);
		}
		self.syncCard(id);
		self.commit();
	};
	var rows = list.map(function(field) {
		var index = chosen.indexOf(field);
		var checkbox = Dom.el(doc, "input", {type: "checkbox"});
		checkbox.checked = index >= 0;
		checkbox.addEventListener("change", function() {
			var next = chosen.slice();
			if (checkbox.checked) {
				next.push(field);
			} else {
				next.splice(next.indexOf(field), 1);
			}
			setFields(next);
		});
		var up = index > 0 ? Dom.button(doc, "up", "Show earlier", function() {
			var next = chosen.slice();
			next.splice(index, 1);
			next.splice(index - 1, 0, field);
			setFields(next);
		}, "pb-btn-small") : null;
		return Dom.el(doc, "div", {"class": "pb-chooser-row" + (index >= 0 ? " pb-chosen" : "")}, [
			Dom.el(doc, "label", null, [checkbox, " ", field]),
			up
		]);
	});
	Dom.clear(el);
	el.appendChild(Dom.el(doc, "div", {"class": "pb-popup-head"}, [
		Dom.el(doc, "strong", {text: "Fields on this card"}),
		Dom.button(doc, "close", "Close", function() { self.closeChooser(); }, "pb-btn-small")
	]));
	el.appendChild(Dom.el(doc, "div", {"class": "pb-popup-sub", text: id}));
	el.appendChild(Dom.el(doc, "div", {"class": "pb-chooser-list"}, rows));
	if (chosen.indexOf("text") >= 0) {
		el.appendChild(this.renderTextModeChoice(id));
	}
	el.appendChild(Dom.el(doc, "div", {"class": "pb-popup-foot"}, [
		Dom.el(doc, "button", {"class": "pb-textbtn", type: "button", text: custom ? "Reset to default" : "Using default", disabled: custom ? undefined : true,
			onclick: function() { setFields(null); }})
	]));
};

var TEXT_MODE_LABELS = {
	full: "Whole text",
	"break": "Text up to the first break",
	image: "First image",
	imagebreak: "First image + text up to the first break"
};

/*
Two choices for long tiddlers: how much of the text the card shows on the
board, and how much when the presentation stops at it.
*/
methods.renderTextModeChoice = function(id) {
	var self = this, doc = this.document;
	var stored = this.data.cards[id] || {};
	var select = function(field, current, sameLabel) {
		var sel = Dom.el(doc, "select", {"class": "pb-select"});
		if (sameLabel) {
			sel.appendChild(Dom.el(doc, "option", {value: "", text: sameLabel}));
		}
		TEXT_MODES.forEach(function(mode) {
			sel.appendChild(Dom.el(doc, "option", {value: mode, text: TEXT_MODE_LABELS[mode]}));
		});
		sel.value = current || "";
		sel.addEventListener("change", function() {
			self.checkpoint();
			var entry = self.data.cards[id] = self.data.cards[id] || {};
			if (sel.value) {
				entry[field] = sel.value;
			} else {
				delete entry[field];
			}
			self.syncCard(id);
			self.commit();
		});
		return sel;
	};
	var modes = this.cardTextModes(id);
	return Dom.el(doc, "div", {"class": "pb-text-modes"}, [
		Dom.el(doc, "label", {"class": "pb-field-row"}, ["Text on the board",
			select("textMode", stored.textMode || modes.board, null)]),
		Dom.el(doc, "label", {"class": "pb-field-row"}, ["Text in the presentation",
			select("presentMode", stored.presentMode, "Same as on the board")])
	]);
};

methods.positionPopups = function() {
	if (this.chooser) {
		var rect = this.cardRect(this.chooser.id);
		if (!rect) {
			this.closeChooser();
		} else {
			this.placePopup(this.chooser.el, rect);
		}
	}
	if (this.effects) {
		var key = this.effects.key;
		var target = key.charAt(0) === "c" ? this.cardRect(key.substr(2)) :
			(Model.findShape(this.data, key.substr(2)) && Model.shapeBounds(Model.findShape(this.data, key.substr(2))));
		if (!target) {
			this.closeEffects();
		} else {
			this.placePopup(this.effects.el, target);
		}
	}
};

methods.placePopup = function(el, rect) {
	var p = this.toScreen(rect.x + rect.w, rect.y);
	var size = this.viewSize();
	var width = el.offsetWidth || 240;
	el.style.left = Math.min(Math.max(8, p.x + 8), size.w - width - 8) + "px";
	el.style.top = Math.min(Math.max(8, p.y), Math.max(8, size.h - (el.offsetHeight || 200) - 8)) + "px";
};
