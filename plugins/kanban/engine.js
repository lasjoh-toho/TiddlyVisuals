/*\
title: $:/plugins/lasjoh-toho/kanban/engine.js
type: application/javascript
module-type: graphengine

Kanban: a TW5-Graph engine that lays nodes out as cards in columns and
swimlanes.

A card's column and swimlane come from fields of its own tiddler (by
default `status`, and no swimlanes), so dragging a card to another cell
rewrites those fields. The lists of columns and swimlanes are graph
properties and can be edited right on the board. Edges are drawn as
arrows between the cards.

\*/

"use strict";

var Model = require("./lib/model.js");

exports.name = "Kanban";

exports.properties = {
	graph: {
		store: {type: "string", description: "Tiddler which keeps the order of the cards, and whose graph settings the board edits"},
		storeField: {type: "string", default: "kanban", description: "Field of the store tiddler holding the order of the cards"},
		columnField: {type: "string", default: "status", description: "Field of each tiddler that decides its column"},
		columns: {type: "string", description: "Columns in order, as a title list (blank: every value the cards have)"},
		laneField: {type: "string", description: "Field of each tiddler that decides its swimlane (blank: no swimlanes)"},
		lanes: {type: "string", description: "Swimlanes in order, as a title list (blank: every value the cards have)"},
		fields: {type: "string", default: "title", description: "Fields shown on cards unless a node chooses otherwise"},
		cardTemplate: {type: "string", description: "Tiddler used to render card bodies"},
		columnWidth: {type: "number", min: 120, default: 260, description: "Width of a column"},
		editable: {type: "boolean", default: true, description: "Allow moving cards and editing columns and swimlanes"},
		zoom: {type: "boolean", default: true},
		focus: {type: "actions"},
		blur: {type: "actions"},
		drop: {type: "actions", variables: ["dropTiddler"]}
	},
	nodes: {
		label: {type: "string"},
		color: {type: "color", default: "graph-node-color"},
		fields: {type: "string", description: "Fields shown on this card"},
		template: {type: "string", description: "Tiddler used to render this card's body"},
		hidden: {type: "boolean", default: false},
		actions: {type: "actions"},
		hover: {type: "actions"},
		blur: {type: "actions"},
		delete: {type: "actions", variables: []}
	},
	edges: {
		label: {type: "string"},
		color: {type: "color"},
		width: {type: "number", min: 0, default: 1.5, increment: 0.5},
		arrows: {type: "enum", default: "to", values: ["no", "to", "from", "middle"], hidden: ["no"], multiple: true},
		stroke: {type: "enum", values: ["solid", "dashed", "dotted"], default: "solid"},
		hidden: {type: "boolean", default: false}
	}
};

exports.messages = {
	"graph-center-node": {
		tiddler: {type: "string"}
	}
};

var TEMPLATE = "$:/plugins/lasjoh-toho/kanban/templates/card";
var NONE = Model.NONE;
var DRAG_THRESHOLD = 4;
var MIN_ZOOM = 0.3, MAX_ZOOM = 2;
var INTERACTIVE = "a, button, input, textarea, select, summary, label, [contenteditable='true'], .tc-tiddlylink";

/*** Lifecycle ***/

exports.init = function(element, objects, options) {
	options = options || {};
	this.wiki = options.wiki || $tw.wiki;
	this.parentWidget = options.widget || $tw.rootWidget;
	this.element = element;
	this.document = element.ownerDocument;
	this.window = this.document.defaultView;
	this.graph = {};
	this.nodes = Object.create(null);
	this.edges = Object.create(null);
	this.cards = Object.create(null);
	this.order = [];
	this.zoom = 1;
	this.editing = null;
	this.buildDom();
	this.onWikiChange = this.handleWikiChange.bind(this);
	this.wiki.addEventListener("change", this.onWikiChange);
	this.applyChanges(objects);
};

exports.update = function(objects) {
	this.applyChanges(objects);
};

exports.destroy = function() {
	if (this.destroyed) {
		return;
	}
	this.destroyed = true;
	this.endDrag(false);
	this.wiki.removeEventListener("change", this.onWikiChange);
	for (var id in this.cards) {
		this.removeCard(id);
	}
	if (this.renderFrame) {
		this.window.cancelAnimationFrame(this.renderFrame);
	}
	this.resizeObserver && this.resizeObserver.disconnect();
	remove(this.root);
};

exports.buildDom = function() {
	var doc = this.document, self = this;
	var children = Array.prototype.slice.call(this.element.childNodes);
	this.root = el(doc, "div", {"class": "kb-root", tabindex: "0"});
	this.scroller = el(doc, "div", {"class": "kb-scroll"});
	this.board = el(doc, "div", {"class": "kb-board"});
	this.grid = el(doc, "div", {"class": "kb-grid"});
	this.edgeLayer = doc.createElementNS(SVGNS, "svg");
	this.edgeLayer.setAttribute("class", "kb-edges");
	this.board.appendChild(this.grid);
	this.board.appendChild(this.edgeLayer);
	this.scroller.appendChild(this.board);
	this.root.appendChild(this.scroller);
	// Elements already in the graph element (overlays rendered by TW5-Graph)
	// must stay, and stay after ours so they overlay the board.
	this.element.insertBefore(this.root, this.element.firstChild);
	for (var i = 0; i < children.length; i++) {
		this.element.appendChild(children[i]);
	}
	var on = function(target, type, method, opts) {
		target.addEventListener(type, method.bind(self), opts);
	};
	on(this.grid, "pointerdown", this.handlePointerDown);
	on(this.scroller, "wheel", this.handleWheel, {passive: false});
	on(this.grid, "dragover", this.handleDragOver);
	on(this.grid, "drop", this.handleDrop);
	on(this.grid, "pointerover", this.handlePointerOver);
	on(this.grid, "pointerout", this.handlePointerOut);
	on(this.root, "focusin", function(event) {
		if (!event.relatedTarget || !this.root.contains(event.relatedTarget)) {
			this.fire("graph", null, "focus", event);
		}
	});
	on(this.root, "focusout", function(event) {
		if (!event.relatedTarget || !this.root.contains(event.relatedTarget)) {
			this.fire("graph", null, "blur", event);
		}
	});
	this.onPointerMove = this.handlePointerMove.bind(this);
	this.onPointerUp = this.handlePointerUp.bind(this);
	if (this.window.ResizeObserver) {
		this.resizeObserver = new this.window.ResizeObserver(function() {
			self.renderEdges();
		});
		this.resizeObserver.observe(this.grid);
	}
};

/*** Applying graph objects ***/

exports.applyChanges = function(objects) {
	if (!objects) {
		return;
	}
	var id;
	if (objects.graph) {
		var prevStore = this.storeKey();
		this.graph = objects.graph;
		this.root.classList.toggle("kb-readonly", !this.isEditable());
		this.root.style.setProperty("--kb-column-width", (this.graph.columnWidth || 260) + "px");
		if (this.storeKey() !== prevStore) {
			this.loadOrder();
		}
		for (id in this.cards) {
			this.syncCard(id);
		}
	}
	if (objects.nodes) {
		for (id in objects.nodes) {
			var node = objects.nodes[id];
			if (node === null) {
				delete this.nodes[id];
				this.removeCard(id);
			} else {
				this.nodes[id] = node;
				this.syncCard(id);
			}
		}
	}
	if (objects.edges) {
		for (id in objects.edges) {
			if (objects.edges[id] === null) {
				delete this.edges[id];
			} else {
				this.edges[id] = objects.edges[id];
			}
		}
	}
	this.scheduleRender();
};

exports.isEditable = function() {
	return this.graph.editable !== false;
};

/*
Columns and swimlanes can be edited on the board when there is a store
tiddler to write them to.
*/
exports.canConfigure = function() {
	return this.isEditable() && !!this.graph.store;
};

exports.handleMessage = function(message, params) {
	switch (message.type) {
	case "graph-center-node":
		this.showCard(params.tiddler);
		break;
	}
};

/*** Persistence ***/

exports.storeKey = function() {
	return (this.graph.store || "") + "\n" + (this.graph.storeField || "kanban");
};

exports.readOrderText = function() {
	var tiddler = this.graph.store && this.wiki.getTiddler(this.graph.store);
	return tiddler ? tiddler.getFieldString(this.graph.storeField || "kanban") : "";
};

exports.loadOrder = function() {
	this.orderText = this.readOrderText();
	this.order = Model.parseList(this.orderText);
};

exports.saveOrder = function() {
	if (!this.graph.store) {
		return;
	}
	// Titles of cards that are no longer on the board are dropped here.
	var ids = Object.keys(this.nodes);
	var order = this.order.filter(function(id) { return ids.indexOf(id) >= 0; });
	var text = Model.stringifyList(order);
	if (text === this.orderText) {
		return;
	}
	this.orderText = text;
	var fields = {};
	fields[this.graph.storeField || "kanban"] = text;
	this.updateTiddler(this.graph.store, fields);
};

/*
Writes a graph property to the store tiddler's graph settings, which is
where the settings dialog keeps them too.
*/
exports.setGraphProperty = function(name, value) {
	var store = this.graph.store;
	if (!store) {
		return;
	}
	var tiddler = this.wiki.getTiddler(store);
	var json = tiddler ? tiddler.getFieldString("graph.graph") : "";
	this.updateTiddler(store, {"graph.graph": Model.setProperty(json, name, value)});
	// Show it right away; the graph will hand us the same value shortly.
	this.graph[name] = value || undefined;
	this.scheduleRender();
};

exports.updateTiddler = function(title, fields) {
	var existing = this.wiki.getTiddler(title);
	var update = {title: title};
	for (var name in fields) {
		update[name] = fields[name];
	}
	this.wiki.addTiddler(new $tw.Tiddler(
		existing ? null : this.wiki.getCreationFields(),
		existing,
		update,
		this.wiki.getModificationFields()));
};

exports.handleWikiChange = function(changes) {
	if (this.destroyed || this.isGarbage()) {
		return;
	}
	var relevant = false;
	if (this.graph.store && changes[this.graph.store]) {
		var text = this.readOrderText();
		if (text !== this.orderText) {
			this.orderText = text;
			this.order = Model.parseList(text);
		}
		relevant = true;
	}
	for (var id in this.cards) {
		var card = this.cards[id];
		card.widget && card.widget.refresh(changes);
		relevant = relevant || !!changes[id];
	}
	if (relevant) {
		this.scheduleRender();
	} else {
		// Card content may have changed size.
		this.scheduleEdges();
	}
};

exports.isGarbage = function() {
	var body = this.document.body;
	return !body || !body.contains(this.root);
};

/*** Events towards TiddlyWiki ***/

exports.fire = function(objectType, id, type, event, variables) {
	if (!this.onevent) {
		return false;
	}
	var props = objectType === "graph" ? this.graph :
		(objectType === "nodes" ? this.nodes[id] : this.edges[id]);
	if (!props || !props[type]) {
		return false;
	}
	var data = {type: type, objectType: objectType, event: event};
	if (objectType !== "graph") {
		data.id = id;
	}
	this.onevent(data, variables || {});
	return true;
};

exports.can = function(objectType, id, type) {
	var props = objectType === "graph" ? this.graph :
		(objectType === "nodes" ? this.nodes[id] : this.edges[id]);
	return !!(props && props[type]);
};

exports.navigate = function(id, event) {
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

/*** Cards ***/

exports.cardFields = function(id) {
	var node = this.nodes[id] || {};
	var choice = node.fields !== undefined ? node.fields : this.graph.fields;
	return Model.parseList(choice === undefined ? "title" : choice);
};

exports.syncCard = function(id) {
	var node = this.nodes[id];
	if (!node) {
		return;
	}
	var card = this.cards[id];
	if (!card) {
		card = this.cards[id] = this.makeCard(id);
	}
	var fields = this.cardFields(id);
	card.el.style.setProperty("--kb-card-color", node.color || "");
	card.el.classList.toggle("kb-hidden", !!node.hidden);
	card.title.textContent = node.label || id;
	card.title.style.display = fields.indexOf("title") >= 0 ? "" : "none";
	card.remove.style.display = (this.isEditable() && node.delete) ? "" : "none";
	var template = node.template || this.graph.cardTemplate || TEMPLATE;
	var others = fields.filter(function(f) { return f !== "title"; });
	var key = template + "\n" + others.join("\n");
	if (key !== card.key) {
		card.key = key;
		if (card.widget) {
			clear(card.body);
			card.widget = null;
		}
		if (others.length) {
			card.widget = this.wiki.makeTranscludeWidget(template, {
				document: this.document,
				parentWidget: this.parentWidget,
				importPageMacros: true,
				mode: "block",
				variables: {
					currentTiddler: id,
					"kanban-fields": Model.stringifyList(others)
				}
			});
			card.widget.render(card.body, null);
		}
		card.body.style.display = others.length ? "" : "none";
	}
};

exports.makeCard = function(id) {
	var doc = this.document, self = this;
	var card = {id: id};
	card.title = el(doc, "div", {"class": "kb-card-title"});
	card.body = el(doc, "div", {"class": "kb-card-body"});
	card.remove = el(doc, "button", {"class": "kb-card-remove", type: "button", title: "Remove from board", "aria-label": "Remove from board"}, ["×"]);
	card.remove.addEventListener("click", function(event) {
		event.stopPropagation();
		self.fire("nodes", id, "delete", event);
	});
	card.el = el(doc, "div", {"class": "kb-card", "data-kb-id": id, tabindex: "-1"}, [card.remove, card.title, card.body]);
	card.el.addEventListener("keydown", function(event) {
		if (event.key === "Enter" && event.target === card.el) {
			self.activateCard(id, event);
		}
	});
	return card;
};

exports.removeCard = function(id) {
	var card = this.cards[id];
	if (card) {
		clear(card.body);
		remove(card.el);
		delete this.cards[id];
	}
};

exports.activateCard = function(id, event) {
	if (!this.fire("nodes", id, "actions", event)) {
		this.navigate(id, event);
	}
};

exports.showCard = function(id) {
	var card = this.cards[id];
	if (card && card.el.parentNode) {
		card.el.scrollIntoView({block: "nearest", inline: "nearest", behavior: "smooth"});
		card.el.classList.remove("kb-flash");
		void card.el.offsetWidth;
		card.el.classList.add("kb-flash");
	}
};

/*** Layout ***/

exports.columnField = function() {
	return this.graph.columnField === undefined ? "status" : this.graph.columnField;
};

exports.laneField = function() {
	return this.graph.laneField || "";
};

exports.computeLayout = function() {
	var self = this;
	var ids = Object.keys(this.nodes).filter(function(id) { return !self.nodes[id].hidden; });
	this.order = Model.normalizeOrder(this.order, Object.keys(this.nodes));
	ids = Model.sortByOrder(ids, this.order);
	var columnField = this.columnField(), laneField = this.laneField();
	var columns = Model.parseList(this.graph.columns), lanes = Model.parseList(this.graph.lanes);
	var fieldsOf = function(id) {
		var tiddler = self.wiki.getTiddler(id);
		return tiddler ? tiddler.fields : undefined;
	};
	return Model.layout(ids, function(id) {
		var fields = fieldsOf(id);
		return {
			column: Model.cardValue(fields, columnField, columns),
			lane: laneField ? Model.cardValue(fields, laneField, lanes) : NONE
		};
	}, {columns: this.graph.columns, lanes: this.graph.lanes, hasLanes: !!laneField});
};

exports.scheduleRender = function() {
	var self = this;
	if (this.renderFrame || this.destroyed) {
		return;
	}
	this.renderFrame = this.window.requestAnimationFrame(function() {
		self.renderFrame = null;
		// Rebuilding would interrupt a drag or wipe out what is being typed;
		// both render when they end.
		if (!self.destroyed && !self.drag && !self.editing) {
			self.renderBoard();
		}
	});
};

exports.scheduleEdges = function() {
	var self = this;
	if (this.edgeFrame || this.destroyed) {
		return;
	}
	this.edgeFrame = this.window.requestAnimationFrame(function() {
		self.edgeFrame = null;
		if (!self.destroyed) {
			self.renderEdges();
		}
	});
};

exports.renderBoard = function() {
	var doc = this.document, self = this;
	var layout = this.layout = this.computeLayout();
	var hasLanes = !!this.laneField();
	var configure = this.canConfigure();
	var focused = doc.activeElement && this.root.contains(doc.activeElement) && doc.activeElement.classList.contains("kb-card") ?
		doc.activeElement.getAttribute("data-kb-id") : null;
	// Card elements are moved, not rebuilt, so their content stays alive.
	clear(this.grid);
	var columnCount = layout.columns.length + (configure ? 1 : 0);
	this.grid.style.gridTemplateColumns = (hasLanes ? "max-content " : "") +
		"repeat(" + columnCount + ", var(--kb-column-width))";
	// Header row
	if (hasLanes) {
		this.grid.appendChild(el(doc, "div", {"class": "kb-corner"}));
	}
	layout.columns.forEach(function(column) {
		var count = 0;
		layout.lanes.forEach(function(lane) {
			count += (layout.cells[Model.cellKey(column, lane)] || []).length;
		});
		self.grid.appendChild(self.renderHeader("column", column, count, layout.columns));
	});
	if (configure) {
		this.grid.appendChild(this.renderAdder("column"));
	}
	// Swimlanes
	layout.lanes.forEach(function(lane) {
		if (hasLanes) {
			var count = 0;
			layout.columns.forEach(function(column) {
				count += (layout.cells[Model.cellKey(column, lane)] || []).length;
			});
			self.grid.appendChild(self.renderHeader("lane", lane, count, layout.lanes));
		}
		layout.columns.forEach(function(column, ci) {
			var ids = layout.cells[Model.cellKey(column, lane)] || [];
			self.grid.appendChild(self.renderCell(column, lane, ids));
		});
		if (configure) {
			self.grid.appendChild(el(doc, "div", {"class": "kb-filler"}));
		}
	});
	if (hasLanes && configure) {
		this.grid.appendChild(this.renderAdder("lane"));
	}
	if (focused && this.cards[focused]) {
		this.cards[focused].el.focus({preventScroll: true});
	}
	this.renderEdges();
};

exports.valueLabel = function(kind, value) {
	if (value !== NONE) {
		return value;
	}
	var field = kind === "column" ? this.columnField() : this.laneField();
	return field ? "No " + field : "Cards";
};

exports.renderHeader = function(kind, value, count, values) {
	var doc = this.document, self = this;
	var header = el(doc, "div", {
		"class": "kb-header kb-" + kind + "-header" + (value === NONE ? " kb-none" : ""),
		"data-kb-kind": kind,
		"data-kb-value": value
	}, [
		el(doc, "span", {"class": "kb-header-label", text: this.valueLabel(kind, value)}),
		el(doc, "span", {"class": "kb-header-count", text: String(count)})
	]);
	if (this.canConfigure() && value !== NONE) {
		var list = values.filter(function(v) { return v !== NONE; });
		var index = list.indexOf(value);
		var back = kind === "column" ? "◂" : "▴", forward = kind === "column" ? "▸" : "▾";
		var tools = el(doc, "span", {"class": "kb-header-tools"}, [
			index > 0 && toolButton(doc, back, "Move " + (kind === "column" ? "left" : "up"), function() {
				self.writeValues(kind, Model.moveValue(list, value, -1));
			}),
			index < list.length - 1 && toolButton(doc, forward, "Move " + (kind === "column" ? "right" : "down"), function() {
				self.writeValues(kind, Model.moveValue(list, value, 1));
			}),
			toolButton(doc, "✎", "Rename", function() {
				self.startEditing({kind: kind, value: value});
			}),
			toolButton(doc, "×", "Remove " + (kind === "column" ? "column" : "swimlane") + " (its cards keep their value)", function() {
				self.writeValues(kind, Model.removeValue(list, value));
			})
		]);
		header.appendChild(tools);
		header.addEventListener("dblclick", function() {
			self.startEditing({kind: kind, value: value});
		});
	}
	return header;
};

exports.renderAdder = function(kind) {
	var doc = this.document, self = this;
	var label = kind === "column" ? "+ Column" : "+ Swimlane";
	var adder = el(doc, "button", {
		"class": "kb-adder kb-" + kind + "-adder",
		type: "button",
		"data-kb-kind": kind,
		"data-kb-value": "\u0001new",
		text: label
	});
	adder.addEventListener("click", function() {
		self.startEditing({kind: kind, value: "\u0001new"});
	});
	return adder;
};

exports.renderCell = function(column, lane, ids) {
	var doc = this.document, self = this;
	var cell = el(doc, "div", {"class": "kb-cell", "data-kb-column": column, "data-kb-lane": lane});
	ids.forEach(function(id) {
		var card = self.cards[id];
		if (card) {
			card.el.classList.remove("kb-dragging");
			cell.appendChild(card.el);
		}
	});
	if (this.isEditable() && this.can("graph", null, "drop")) {
		var add = el(doc, "button", {"class": "kb-add-card", type: "button", title: "Add a tiddler here", text: "+"});
		add.addEventListener("click", function() {
			self.startEditing({kind: "card", column: column, lane: lane});
		});
		cell.appendChild(add);
	}
	return cell;
};

/*** Editing columns, swimlanes and new cards inline ***/

exports.writeValues = function(kind, list) {
	this.setGraphProperty(kind === "column" ? "columns" : "lanes", Model.stringifyList(list));
};

exports.currentValues = function(kind) {
	var values = this.layout ? (kind === "column" ? this.layout.columns : this.layout.lanes) : [];
	return values.filter(function(v) { return v !== NONE; });
};

exports.startEditing = function(editing) {
	var doc = this.document, self = this;
	var target;
	if (editing.kind === "card") {
		target = this.findCell(editing.column, editing.lane);
		target = target && target.querySelector(".kb-add-card");
	} else {
		var nodes = this.grid.querySelectorAll("[data-kb-kind='" + editing.kind + "']");
		for (var i = 0; i < nodes.length; i++) {
			if (nodes[i].getAttribute("data-kb-value") === editing.value) {
				target = nodes[i];
			}
		}
	}
	if (!target) {
		this.editing = null;
		return;
	}
	this.editing = editing;
	var isNew = editing.value === "\u0001new";
	var input = el(doc, "input", {
		"class": "kb-input",
		type: "text",
		placeholder: editing.kind === "card" ? "Tiddler title" : (editing.kind === "column" ? "Column name" : "Swimlane name"),
		value: (editing.kind === "card" || isNew) ? "" : editing.value
	});
	var done = false;
	var finish = function(commit) {
		if (done) {
			return;
		}
		done = true;
		self.editing = null;
		var text = input.value.trim();
		if (commit && text) {
			self.commitEditing(editing, text);
		}
		self.scheduleRender();
	};
	input.addEventListener("keydown", function(event) {
		if (event.key === "Enter") {
			event.preventDefault();
			finish(true);
		} else if (event.key === "Escape") {
			event.preventDefault();
			finish(false);
		}
		event.stopPropagation();
	});
	input.addEventListener("blur", function() {
		finish(true);
	});
	var wrapper = el(doc, "div", {"class": "kb-editor kb-" + editing.kind + "-editor"}, [input]);
	target.parentNode.replaceChild(wrapper, target);
	input.focus();
	input.select();
};

exports.commitEditing = function(editing, text) {
	var kind = editing.kind;
	if (kind === "card") {
		this.addCard(text, editing.column, editing.lane);
		return;
	}
	var list = this.currentValues(kind);
	if (editing.value === "\u0001new") {
		this.writeValues(kind, Model.insertValue(list, text));
		return;
	}
	if (text === editing.value) {
		return;
	}
	// Renaming a column renames the value on its cards too.
	var field = kind === "column" ? this.columnField() : this.laneField();
	var self = this;
	var layout = this.layout;
	if (field) {
		var values = layout ? (kind === "column" ? layout.columns : layout.lanes) : [];
		for (var key in layout.cells) {
			var parts = key.split("\u0000");
			var value = kind === "column" ? parts[0] : parts[1];
			if (value === editing.value) {
				layout.cells[key].forEach(function(id) {
					var tiddler = self.wiki.getTiddler(id);
					var changes = Model.assignValue(tiddler && tiddler.fields, field, text, values.concat([text]));
					changes && self.updateTiddler(id, changes);
				});
			}
		}
	}
	this.writeValues(kind, Model.renameValue(list, editing.value, text));
};

exports.addCard = function(title, column, lane) {
	this.assignCell(title, column, lane);
	if (!this.nodes[title]) {
		this.order = this.order.filter(function(id) { return id !== title; });
		this.order.push(title);
		this.saveOrder();
		this.fire("graph", null, "drop", null, {dropTiddler: title});
	}
	this.scheduleRender();
};

/*
Rewrites the card's fields so it lands in the given cell. Creates the
tiddler when it does not exist.
*/
exports.assignCell = function(id, column, lane) {
	var tiddler = this.wiki.getTiddler(id);
	var fields = tiddler ? tiddler.fields : undefined;
	var layout = this.layout || {columns: [], lanes: []};
	var changes = {};
	var columnChanges = Model.assignValue(fields, this.columnField(), column, layout.columns);
	var laneChanges = this.laneField() ? Model.assignValue(fields, this.laneField(), lane, layout.lanes) : null;
	$tw.utils.extend(changes, columnChanges, laneChanges);
	if (!tiddler || Object.keys(changes).length) {
		this.updateTiddler(id, changes);
	}
};

exports.findCell = function(column, lane) {
	var cells = this.grid.querySelectorAll(".kb-cell");
	for (var i = 0; i < cells.length; i++) {
		if (cells[i].getAttribute("data-kb-column") === column && cells[i].getAttribute("data-kb-lane") === lane) {
			return cells[i];
		}
	}
	return null;
};

/*** Dragging cards ***/

exports.handlePointerDown = function(event) {
	if (event.button !== 0 || this.drag) {
		return;
	}
	var cardEl = closest(event.target, ".kb-card", this.grid);
	if (!cardEl || closest(event.target, INTERACTIVE, cardEl)) {
		return;
	}
	this.drag = {
		id: cardEl.getAttribute("data-kb-id"),
		el: cardEl,
		startX: event.clientX,
		startY: event.clientY,
		moving: false
	};
	this.document.addEventListener("pointermove", this.onPointerMove);
	this.document.addEventListener("pointerup", this.onPointerUp);
	this.document.addEventListener("pointercancel", this.onPointerUp);
};

exports.handlePointerMove = function(event) {
	var drag = this.drag;
	if (!drag) {
		return;
	}
	if (!drag.moving) {
		if (!this.isEditable() || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) {
			return;
		}
		this.beginDrag(event);
	}
	event.preventDefault();
	drag.ghost.style.transform = "translate(" + (event.clientX - drag.offsetX) + "px," + (event.clientY - drag.offsetY) + "px) rotate(2deg)";
	this.placePlaceholder(event.clientX, event.clientY);
	this.autoScroll(event.clientX, event.clientY);
};

exports.beginDrag = function(event) {
	var drag = this.drag, doc = this.document;
	var rect = drag.el.getBoundingClientRect();
	drag.moving = true;
	drag.offsetX = drag.startX - rect.left;
	drag.offsetY = drag.startY - rect.top;
	drag.ghost = drag.el.cloneNode(true);
	drag.ghost.className = "kb-card kb-ghost";
	drag.ghost.style.width = rect.width + "px";
	drag.ghost.style.zoom = this.zoom;
	doc.body.appendChild(drag.ghost);
	drag.placeholder = el(doc, "div", {"class": "kb-placeholder"});
	drag.placeholder.style.height = (rect.height / this.zoom) + "px";
	drag.el.parentNode.insertBefore(drag.placeholder, drag.el);
	drag.el.classList.add("kb-dragging");
	drag.el.parentNode.removeChild(drag.el);
	this.root.classList.add("kb-is-dragging");
	this.fire("nodes", drag.id, "blur", event);
};

exports.placePlaceholder = function(x, y) {
	var drag = this.drag;
	var target = this.document.elementFromPoint(x, y);
	var cell = closest(target, ".kb-cell", this.grid);
	if (!cell) {
		return;
	}
	var cards = cell.querySelectorAll(".kb-card");
	var before = cell.querySelector(".kb-add-card");
	for (var i = 0; i < cards.length; i++) {
		var r = cards[i].getBoundingClientRect();
		if (y < r.top + r.height / 2) {
			before = cards[i];
			break;
		}
	}
	if (drag.placeholder.parentNode !== cell || drag.placeholder.nextSibling !== before) {
		cell.insertBefore(drag.placeholder, before);
		this.renderEdges();
	}
};

exports.autoScroll = function(x, y) {
	var rect = this.scroller.getBoundingClientRect();
	var margin = 40, step = 18;
	if (x < rect.left + margin) {
		this.scroller.scrollLeft -= step;
	} else if (x > rect.right - margin) {
		this.scroller.scrollLeft += step;
	}
	if (y < rect.top + margin) {
		this.scroller.scrollTop -= step;
	} else if (y > rect.bottom - margin) {
		this.scroller.scrollTop += step;
	}
};

exports.handlePointerUp = function(event) {
	var drag = this.drag;
	if (!drag) {
		return;
	}
	if (drag.moving) {
		this.endDrag(event.type !== "pointercancel");
	} else {
		this.endDrag(false);
		if (event.type === "pointerup") {
			this.activateCard(drag.id, event);
		}
	}
};

exports.endDrag = function(commit) {
	var drag = this.drag;
	if (!drag) {
		return;
	}
	this.drag = null;
	this.document.removeEventListener("pointermove", this.onPointerMove);
	this.document.removeEventListener("pointerup", this.onPointerUp);
	this.document.removeEventListener("pointercancel", this.onPointerUp);
	if (!drag.moving) {
		return;
	}
	remove(drag.ghost);
	this.root.classList.remove("kb-is-dragging");
	var cell = drag.placeholder.parentNode;
	if (commit && cell) {
		var column = cell.getAttribute("data-kb-column");
		var lane = cell.getAttribute("data-kb-lane");
		var ids = [];
		for (var child = cell.firstChild; child; child = child.nextSibling) {
			if (child === drag.placeholder) {
				ids.push(drag.id);
			} else if (child.classList && child.classList.contains("kb-card")) {
				ids.push(child.getAttribute("data-kb-id"));
			}
		}
		this.order = Model.placeInOrder(Model.normalizeOrder(this.order, Object.keys(this.nodes)), drag.id, ids);
		this.saveOrder();
		this.assignCell(drag.id, column, lane);
	}
	remove(drag.placeholder);
	this.renderBoard();
	this.cards[drag.id] && this.cards[drag.id].el.focus({preventScroll: true});
};

/*** Other input ***/

exports.handleWheel = function(event) {
	if (!(event.ctrlKey || event.metaKey) || this.graph.zoom === false) {
		return;
	}
	event.preventDefault();
	var factor = Math.exp(-event.deltaY * 0.002);
	this.setZoom(this.zoom * factor);
};

exports.setZoom = function(zoom) {
	this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
	this.board.style.zoom = this.zoom;
	this.renderEdges();
};

exports.handleDragOver = function(event) {
	if (this.isEditable() && this.can("graph", null, "drop") && closest(event.target, ".kb-cell", this.grid)) {
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}
};

exports.handleDrop = function(event) {
	var cell = closest(event.target, ".kb-cell", this.grid);
	if (!cell || !this.isEditable() || !this.can("graph", null, "drop")) {
		return;
	}
	var title = getDroppedTitle(event.dataTransfer);
	if (title) {
		event.preventDefault();
		event.stopPropagation();
		this.addCard(title, cell.getAttribute("data-kb-column"), cell.getAttribute("data-kb-lane"));
	}
};

function getDroppedTitle(dataTransfer) {
	if (!dataTransfer) {
		return null;
	}
	var json = dataTransfer.getData("text/vnd.tiddler");
	if (json) {
		try {
			var parsed = JSON.parse(json);
			if (parsed && parsed.title) {
				return parsed.title;
			}
		} catch (e) {}
	}
	var text = dataTransfer.getData("text/plain");
	return text ? text.trim().split("\n")[0] : null;
}

exports.handlePointerOver = function(event) {
	var cardEl = closest(event.target, ".kb-card", this.grid);
	var id = cardEl ? cardEl.getAttribute("data-kb-id") : null;
	if (id !== this.hovered && !this.drag) {
		this.hovered && this.fire("nodes", this.hovered, "blur", event);
		this.hovered = id;
		id && this.fire("nodes", id, "hover", event);
	}
};

exports.handlePointerOut = function(event) {
	if (this.hovered && (!event.relatedTarget || !closest(event.relatedTarget, ".kb-card[data-kb-id]", this.grid))) {
		this.fire("nodes", this.hovered, "blur", event);
		this.hovered = null;
	}
};

/*** Connections ***/

/*
Position of a card relative to the board, in unzoomed pixels.
*/
exports.cardRect = function(id) {
	var card = this.cards[id];
	if (!card || !card.el.parentNode || card.el.classList.contains("kb-dragging") || !this.grid.contains(card.el)) {
		return null;
	}
	var x = 0, y = 0, node = card.el;
	while (node && node !== this.board) {
		x += node.offsetLeft;
		y += node.offsetTop;
		node = node.offsetParent;
	}
	if (!node) {
		return null;
	}
	return {x: x, y: y, w: card.el.offsetWidth, h: card.el.offsetHeight};
};

exports.renderEdges = function() {
	var layer = this.edgeLayer, doc = this.document;
	while (layer.firstChild) {
		layer.removeChild(layer.firstChild);
	}
	layer.setAttribute("width", this.board.scrollWidth);
	layer.setAttribute("height", this.board.scrollHeight);
	for (var id in this.edges) {
		var edge = this.edges[id];
		if (edge.hidden || edge.from === edge.to) {
			continue;
		}
		var r1 = this.cardRect(edge.from), r2 = this.cardRect(edge.to);
		if (!r1 || !r2) {
			continue;
		}
		layer.appendChild(renderEdge(doc, edge, r1, r2));
	}
};

function renderEdge(doc, edge, r1, r2) {
	var c1 = {x: r1.x + r1.w / 2, y: r1.y + r1.h / 2};
	var c2 = {x: r2.x + r2.w / 2, y: r2.y + r2.h / 2};
	var s = Model.clipToRect(r1, c2.x, c2.y, 3);
	var e = Model.clipToRect(r2, c1.x, c1.y, 3);
	var width = edge.width !== undefined ? edge.width : 1.5;
	var group = svg(doc, "g", {"class": "kb-edge"});
	var line = svg(doc, "path", {"class": "kb-edge-line", d: "M" + r(s.x) + " " + r(s.y) + "L" + r(e.x) + " " + r(e.y)});
	line.style.strokeWidth = width;
	if (edge.color) {
		line.style.stroke = edge.color;
	}
	if (edge.stroke === "dashed") {
		line.style.strokeDasharray = (4 + width * 3) + " " + (3 + width * 2);
	} else if (edge.stroke === "dotted") {
		line.style.strokeDasharray = "0 " + (3 + width * 2);
		line.style.strokeLinecap = "round";
	}
	group.appendChild(line);
	var arrows = edge.arrows;
	if (arrows === undefined || arrows === null) {
		arrows = ["to"];
	} else if (!Array.isArray(arrows)) {
		arrows = [arrows];
	}
	var dx = e.x - s.x, dy = e.y - s.y;
	var mid = {x: (s.x + e.x) / 2, y: (s.y + e.y) / 2};
	var size = 6 + width * 2;
	arrows.forEach(function(kind) {
		var at = kind === "to" ? {x: e.x, y: e.y, dx: dx, dy: dy} :
			(kind === "from" ? {x: s.x, y: s.y, dx: -dx, dy: -dy} :
			(kind === "middle" ? {x: mid.x, y: mid.y, dx: dx, dy: dy} : null));
		if (at) {
			var head = svg(doc, "path", {"class": "kb-edge-head", d: arrowHead(at, size)});
			if (edge.color) {
				head.style.fill = edge.color;
			}
			group.appendChild(head);
		}
	});
	if (edge.label) {
		var text = svg(doc, "text", {"class": "kb-edge-label", x: r(mid.x), y: r(mid.y), "text-anchor": "middle", "dominant-baseline": "central"});
		text.textContent = edge.label;
		group.appendChild(text);
	}
	return group;
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

/*** DOM helpers ***/

var SVGNS = "http://www.w3.org/2000/svg";

function el(doc, tag, attrs, children) {
	var node = doc.createElement(tag);
	for (var name in attrs || {}) {
		if (name === "text") {
			node.textContent = attrs[name];
		} else if (attrs[name] !== undefined && attrs[name] !== null) {
			node.setAttribute(name, attrs[name]);
		}
	}
	(children || []).forEach(function(child) {
		if (child) {
			node.appendChild(typeof child === "string" ? doc.createTextNode(child) : child);
		}
	});
	return node;
}

function svg(doc, tag, attrs) {
	var node = doc.createElementNS(SVGNS, tag);
	for (var name in attrs) {
		node.setAttribute(name, attrs[name]);
	}
	return node;
}

function toolButton(doc, symbol, title, onclick) {
	var button = el(doc, "button", {"class": "kb-tool", type: "button", title: title, "aria-label": title, text: symbol});
	button.addEventListener("click", function(event) {
		event.stopPropagation();
		onclick(event);
	});
	return button;
}

function closest(node, selector, stop) {
	while (node && node !== stop && node.nodeType === 1) {
		if (node.matches && node.matches(selector)) {
			return node;
		}
		node = node.parentNode;
	}
	return null;
}

function clear(node) {
	while (node.firstChild) {
		node.removeChild(node.firstChild);
	}
}

function remove(node) {
	if (node && node.parentNode) {
		node.parentNode.removeChild(node);
	}
}
