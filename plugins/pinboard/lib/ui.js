/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/ui.js
type: application/javascript
module-type: library

The Pinboard's chrome: tool dock, zoom bar, presentation path panel,
context bar for the selection, and the full-height tiddler viewer.

\*/

"use strict";

var Model = require("./model.js");
var Dom = require("./dom.js");

var MODAL_TEMPLATE = "$:/plugins/lasjoh-toho/pinboard/templates/modal";

var COLORS = ["#1f2937", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ffffff"];
var WIDTHS = [2, 4, 8];
var TOOL_GROUPS = [
	[["select", "Select and move (V)"], ["hand", "Pan (H, or hold Space)"]],
	[["pen", "Pen (P)"], ["highlighter", "Highlighter (M)"], ["eraser", "Eraser (E)"]],
	[["rect", "Rectangle (R)"], ["ellipse", "Ellipse (O)"], ["line", "Line (L)"], ["arrow", "Arrow (A)"]],
	[["text", "Text (T)"], ["sticky", "Sticky note (N)"], ["frame", "Presentation frame (F)"], ["card", "Add tiddler card (C)"]]
];

var methods = exports.methods = {};

methods.buildUi = function() {
	var doc = this.document, self = this;
	var el = function(tag, attrs, children) { return Dom.el(doc, tag, attrs, children); };
	// Tool dock
	this.toolButtons = Object.create(null);
	var dock = el("div", {"class": "pb-toolbar pb-chrome"});
	TOOL_GROUPS.forEach(function(group) {
		var g = el("div", {"class": "pb-group"});
		group.forEach(function(entry) {
			var btn = Dom.button(doc, entry[0], entry[1], function() { self.setTool(entry[0]); });
			self.toolButtons[entry[0]] = btn;
			g.appendChild(btn);
		});
		dock.appendChild(g);
	});
	// Colors
	this.colorButtons = [];
	var colors = el("div", {"class": "pb-group pb-colors"});
	COLORS.forEach(function(color) {
		var btn = el("button", {"class": "pb-swatch", type: "button", title: color, style: {"--pb-swatch": color},
			onclick: function() { self.applyStyle("stroke", color); }});
		btn.setAttribute("data-color", color);
		self.colorButtons.push(btn);
		colors.appendChild(btn);
	});
	this.customColor = el("input", {type: "color", "class": "pb-color-input", title: "Custom color", value: "#1f2937",
		onchange: function() { self.applyStyle("stroke", self.customColor.value); }});
	colors.appendChild(this.customColor);
	dock.appendChild(colors);
	// Widths + fill
	this.widthButtons = [];
	var widths = el("div", {"class": "pb-group"});
	WIDTHS.forEach(function(w) {
		var btn = el("button", {"class": "pb-btn pb-width", type: "button", title: "Stroke width " + w,
			onclick: function() { self.applyStyle("width", w); }}, [
			el("span", {"class": "pb-width-dot", style: {width: (w * 1.6 + 3) + "px", height: (w * 1.6 + 3) + "px"}})
		]);
		btn.setAttribute("data-width", w);
		self.widthButtons.push(btn);
		widths.appendChild(btn);
	});
	this.fillButton = el("button", {"class": "pb-btn pb-fill", type: "button", title: "Fill shapes",
		onclick: function() {
			var shape = self.selectedShape();
			var current = shape ? shape.fill : self.style.fill;
			self.applyStyle("fill", current && current !== "none" ? "none" : tint(self.style.stroke));
		}}, [el("span", {"class": "pb-fill-swatch"})]);
	widths.appendChild(this.fillButton);
	dock.appendChild(widths);
	// History
	this.undoButton = Dom.button(doc, "undo", "Undo (Ctrl+Z)", function() { self.undo(); });
	this.redoButton = Dom.button(doc, "redo", "Redo (Ctrl+Shift+Z)", function() { self.redo(); });
	dock.appendChild(el("div", {"class": "pb-group"}, [this.undoButton, this.redoButton]));
	this.toolbar = dock;
	this.root.appendChild(dock);

	// Top right: presentation
	this.stepsButton = Dom.button(doc, "steps", "Presentation path", function() { self.toggleSteps(); });
	this.root.appendChild(el("div", {"class": "pb-topbar pb-chrome"}, [
		this.stepsButton,
		Dom.button(doc, "play", "Present (from the first step)", function() { self.startPresentation(0); }, "pb-btn-primary")
	]));

	// Bottom right: zoom
	this.zoomLabel = el("button", {"class": "pb-zoom-label", type: "button", title: "Reset to 100%",
		onclick: function() { self.zoomBy(1 / self.camera.s); self.rememberView(); }});
	this.root.appendChild(el("div", {"class": "pb-zoombar pb-chrome"}, [
		Dom.button(doc, "minus", "Zoom out (-)", function() { self.zoomBy(0.8); self.rememberView(); }),
		this.zoomLabel,
		Dom.button(doc, "plus", "Zoom in (+)", function() { self.zoomBy(1.25); self.rememberView(); }),
		Dom.button(doc, "fit", "Fit everything (0)", function() { self.fitAll(true); self.rememberView(); })
	]));

	// Notice when nothing can be saved
	this.notice = el("div", {"class": "pb-notice pb-chrome", text: "Drawings are not saved: give this graph a “store” property."});
	this.root.appendChild(this.notice);

	// Context bar for the selection
	this.contextBar = el("div", {"class": "pb-context pb-chrome"});
	this.root.appendChild(this.contextBar);

	// Presentation path panel
	this.stepsPanel = el("div", {"class": "pb-steps pb-chrome"});
	this.root.appendChild(this.stepsPanel);
	this.root.setAttribute("data-pb-tool", this.tool);
};

methods.updateUi = function() {
	if (!this.toolbar) {
		return;
	}
	var self = this;
	for (var tool in this.toolButtons) {
		$tw.utils.toggleClass(this.toolButtons[tool], "pb-active", tool === this.tool);
	}
	this.toolButtons.card.style.display = this.can("graph", null, "addNode") ? "" : "none";
	var shape = this.selectedShape();
	var stroke = shape ? shape.stroke : this.style.stroke;
	var width = shape ? (shape.type === "highlighter" ? shape.width / 5 : shape.width) : this.style.width;
	var fill = shape ? shape.fill : this.style.fill;
	this.colorButtons.forEach(function(btn) {
		$tw.utils.toggleClass(btn, "pb-active", btn.getAttribute("data-color") === stroke);
	});
	this.widthButtons.forEach(function(btn) {
		$tw.utils.toggleClass(btn, "pb-active", Number(btn.getAttribute("data-width")) === width);
	});
	$tw.utils.toggleClass(this.fillButton, "pb-active", !!fill && fill !== "none");
	this.fillButton.style.setProperty("--pb-swatch", fill && fill !== "none" ? fill : "transparent");
	this.undoButton.disabled = this.undoStack.length === 0;
	this.redoButton.disabled = this.redoStack.length === 0;
	this.notice.style.display = (!this.graph.store && this.isEditable() &&
		(this.data.shapes.length > 0 || this.data.steps.length > 0)) ? "" : "none";
	$tw.utils.toggleClass(this.stepsButton, "pb-active", !!this.stepsOpen);
	this.renderContextBar();
	if (this.stepsOpen) {
		this.renderSteps();
	}
	this.updateZoomLabel();
};

methods.updateZoomLabel = function() {
	if (this.zoomLabel) {
		this.zoomLabel.textContent = Math.round(this.camera.s * 100) + "%";
	}
};

/*** Context bar ***/

methods.renderContextBar = function() {
	var doc = this.document, self = this;
	var bar = this.contextBar;
	Dom.clear(bar);
	var sel = this.selection;
	if (!sel || this.presenting || sel.type !== "shape") {
		bar.style.display = "none";
		return;
	}
	var buttons = [];
	if (sel.type === "shape") {
		var shape = this.selectedShape();
		if (!shape || !this.isEditable()) {
			bar.style.display = "none";
			return;
		}
		if (Model.hasText(shape.type)) {
			buttons.push(Dom.button(doc, "text", shape.type === "frame" ? "Frame title" : "Edit text", function() { self.editShapeText(shape); }));
		}
		if (shape.layer === "back") {
			buttons.push(Dom.button(doc, "front", "Bring above cards", function() { self.setShapeLayer("front"); }));
		} else {
			buttons.push(Dom.button(doc, "back", "Send behind cards", function() { self.setShapeLayer("back"); }));
		}
		buttons.push(Dom.button(doc, "target", "Add to presentation path", function() {
			self.addStep({kind: shape.type === "frame" ? "frame" : "shape", ref: shape.id});
		}));
		if (shape.type !== "frame") {
			buttons.push(Dom.button(doc, "eye", "Appear / disappear during the presentation", function() {
				self.openEffects("s:" + shape.id);
			}, shape.build || shape.exit ? "pb-active" : ""));
		}
		buttons.push(Dom.button(doc, "plus", "Duplicate (Ctrl+D)", function() { self.duplicateSelection(); }));
		buttons.push(Dom.button(doc, "trash", "Delete (Del)", function() { self.deleteSelection(); }));
	} else {
		// Cards carry their own tools.
		bar.style.display = "none";
		return;
	}
	buttons.forEach(function(b) { bar.appendChild(b); });
	bar.style.display = "";
	this.positionContextBar();
};

methods.positionContextBar = function() {
	var bar = this.contextBar;
	if (!bar || bar.style.display === "none" || !this.selection) {
		return;
	}
	var sel = this.selection, rect = null;
	if (sel.type === "shape") {
		var shape = this.selectedShape();
		rect = shape && Model.shapeBounds(shape);
	}
	if (!rect) {
		bar.style.display = "none";
		return;
	}
	var p = this.toScreen(rect.x + rect.w / 2, rect.y);
	var size = this.viewSize();
	var width = bar.offsetWidth || 160;
	// Leave room for the rotate handle above box shapes.
	var shapeAbove = sel.type === "shape" && Model.isBoxType((this.selectedShape() || {}).type);
	var top = p.y - 48 - (shapeAbove ? 40 : 0);
	if (top < 8) {
		top = this.toScreen(0, rect.y + rect.h).y + 12;
	}
	bar.style.left = Math.min(Math.max(8, p.x - width / 2), size.w - width - 8) + "px";
	bar.style.top = Math.min(Math.max(8, top), size.h - 48) + "px";
};

/*** Presentation path ***/

methods.toggleSteps = function(open) {
	this.stepsOpen = open === undefined ? !this.stepsOpen : open;
	$tw.utils.toggleClass(this.stepsPanel, "pb-open", this.stepsOpen);
	this.updateUi();
};

methods.addStep = function(step) {
	if (!this.isEditable()) {
		return;
	}
	this.checkpoint();
	step.id = Model.newId("t");
	this.data.steps.push(step);
	this.commit();
	this.toggleSteps(true);
};

methods.stepTitle = function(step) {
	if (step.title) {
		return step.title;
	}
	switch (step.kind) {
	case "frame":
	case "shape":
		var shape = Model.findShape(this.data, step.ref);
		if (!shape) {
			return "(missing)";
		}
		return shape.text ? shape.text.split("\n")[0] : (step.kind === "frame" ? "Frame" : capitalize(shape.type));
	case "card":
		var node = this.nodes[step.ref];
		return node ? (node.label || step.ref) : step.ref + " (not on board)";
	case "view":
		return "Saved view";
	}
	return step.kind;
};

methods.stepPadding = function(step) {
	return step.kind === "frame" || step.kind === "view" ? 0.01 : 0.1;
};

methods.renderSteps = function() {
	var doc = this.document, self = this;
	var panel = this.stepsPanel;
	var editable = this.isEditable();
	Dom.clear(panel);
	panel.appendChild(Dom.el(doc, "div", {"class": "pb-popup-head"}, [
		Dom.el(doc, "strong", {text: "Presentation path"}),
		Dom.button(doc, "close", "Close", function() { self.toggleSteps(false); }, "pb-btn-small")
	]));
	var steps = this.data.steps;
	var list = Dom.el(doc, "ol", {"class": "pb-step-list"});
	steps.forEach(function(step, index) {
		var missing = !self.stepTarget(step);
		var move = function(delta) {
			var to = index + delta;
			if (to < 0 || to >= steps.length) {
				return;
			}
			self.checkpoint();
			var item = steps.splice(index, 1)[0];
			steps.splice(to, 0, item);
			self.commit();
		};
		list.appendChild(Dom.el(doc, "li", {"class": "pb-step" + (missing ? " pb-missing" : "") + (self.presenting && self.presentIndex === index ? " pb-current" : "")}, [
			Dom.el(doc, "button", {"class": "pb-step-name", type: "button", title: "Show this step",
				onclick: function() {
					var target = self.stepTarget(step);
					target && self.flyTo(target.rect, self.stepPadding(step), true, target.rot);
				}}, [
				Dom.el(doc, "span", {"class": "pb-step-kind pb-step-kind-" + step.kind, text: String(index + 1)}),
				Dom.el(doc, "span", {"class": "pb-step-title", text: self.stepTitle(step)})
			]),
			editable ? Dom.button(doc, "up", "Earlier", function() { move(-1); }, "pb-btn-small") : null,
			editable ? Dom.button(doc, "down", "Later", function() { move(1); }, "pb-btn-small") : null,
			Dom.button(doc, "play", "Present from here", function() { self.startPresentation(index); }, "pb-btn-small"),
			editable ? Dom.button(doc, "close", "Remove from path", function() {
				self.checkpoint();
				steps.splice(index, 1);
				self.commit();
			}, "pb-btn-small") : null
		]));
	});
	if (steps.length === 0) {
		panel.appendChild(Dom.el(doc, "p", {"class": "pb-empty",
			text: "Draw frames with the frame tool, or add cards, shapes and views. Each one becomes a stop of the presentation."}));
	}
	panel.appendChild(list);
	if (editable) {
		panel.appendChild(Dom.el(doc, "div", {"class": "pb-popup-foot"}, [
			Dom.el(doc, "button", {"class": "pb-textbtn", type: "button", text: "+ Current view",
				onclick: function() {
					var size = self.viewSize();
					var v = Model.viewRect(self.camera, size.w, size.h);
					self.addStep({kind: "view", x: Math.round(v.x), y: Math.round(v.y), w: Math.round(v.w), h: Math.round(v.h)});
				}}),
			Dom.el(doc, "button", {"class": "pb-textbtn", type: "button", text: "+ Frame",
				onclick: function() { self.setTool("frame"); }})
		]));
	}
	if (steps.length > 0) {
		panel.appendChild(Dom.el(doc, "div", {"class": "pb-popup-foot"}, [
			Dom.el(doc, "button", {"class": "pb-textbtn pb-textbtn-primary", type: "button", text: "\u25b6 Present",
				onclick: function() { self.startPresentation(0); }}),
			Dom.el(doc, "button", {"class": "pb-textbtn", type: "button", text: "Export as HTML",
				title: "Download a self-contained HTML file that plays this presentation anywhere",
				onclick: function() { self.downloadPresentation(); }})
		]));
	}
};

function capitalize(s) {
	return s.charAt(0).toUpperCase() + s.substr(1);
}

function tint(color) {
	var rgb = Model.parseColor(color);
	if (!rgb) {
		return "#e5e7eb";
	}
	// Mix 30% of the color with white.
	return "#" + rgb.map(function(c) {
		var v = Math.round(255 - (255 - c) * 0.3);
		return (v < 16 ? "0" : "") + v.toString(16);
	}).join("");
}

/*** Tiddler viewer ***/

methods.openModal = function(title) {
	var doc = this.document, self = this;
	this.closeModal();
	var host = doc.fullscreenElement || doc.body;
	var modal = {title: title, editing: false};
	modal.content = Dom.el(doc, "div", {"class": "pb-modal-content"});
	modal.editButton = Dom.el(doc, "button", {"class": "pb-modal-btn", type: "button", title: "Edit this tiddler",
		onclick: function() { self.setModalEditing(!modal.editing); }}, [Dom.icon(doc, "edit"), Dom.el(doc, "span", {text: "Edit"})]);
	modal.controls = Dom.el(doc, "div", {"class": "pb-modal-controls"}, [
		modal.editButton,
		Dom.el(doc, "button", {"class": "pb-modal-btn", type: "button", title: "Open in story river",
			onclick: function() { var t = modal.title; self.closeModal(); self.navigate(t); }}, [Dom.icon(doc, "open")]),
		Dom.el(doc, "button", {"class": "pb-modal-btn pb-modal-close", type: "button", title: "Close (Esc)",
			onclick: function() { self.closeModal(); }}, [Dom.icon(doc, "close"), Dom.el(doc, "span", {text: "Close"})])
	]);
	modal.sheet = Dom.el(doc, "div", {"class": "pb-modal-sheet", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1"}, [
		modal.controls, modal.content
	]);
	modal.el = Dom.el(doc, "div", {"class": "pb-modal"}, [modal.sheet]);
	modal.el.addEventListener("click", function(event) {
		if (event.target === modal.el) {
			self.closeModal();
		}
	});
	modal.el.addEventListener("keydown", function(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			if (modal.editing) {
				self.setModalEditing(false);
			} else {
				self.closeModal();
			}
		}
	});
	this.modal = modal;
	host.appendChild(modal.el);
	this.renderModal();
	modal.sheet.focus({preventScroll: true});
};

/*
Links inside the viewer open their target in the viewer instead of the
story river, so reading stays on the board.
*/
methods.modalParentWidget = function() {
	var self = this;
	var parent = Object.create(this.parentWidget);
	parent.dispatchEvent = function(event) {
		if (event.type === "tm-navigate" && event.navigateTo && self.modal) {
			self.openModal(event.navigateTo);
			return false;
		}
		if (event.type === "tm-edit-tiddler" && self.modal) {
			self.setModalEditing(true);
			return false;
		}
		if (event.type === "tm-close-tiddler" && self.modal) {
			self.closeModal();
			return false;
		}
		return self.parentWidget.dispatchEvent(event);
	};
	return parent;
};

methods.renderModal = function() {
	var modal = this.modal;
	if (!modal) {
		return;
	}
	Dom.clear(modal.content);
	modal.textBefore = this.wiki.getTiddlerText(modal.title);
	modal.widget = this.wiki.makeTranscludeWidget(MODAL_TEMPLATE, {
		document: this.document,
		parentWidget: this.modalParentWidget(),
		importPageMacros: true,
		mode: "block",
		variables: {
			currentTiddler: modal.title,
			"pinboard-editing": modal.editing ? "yes" : "no"
		}
	});
	modal.widget.render(modal.content, null);
	$tw.utils.toggleClass(modal.el, "pb-modal-editing", modal.editing);
	modal.editButton.lastChild.textContent = modal.editing ? "Done" : "Edit";
	modal.editButton.title = modal.editing ? "Finish editing" : "Edit this tiddler";
};

methods.setModalEditing = function(editing) {
	var modal = this.modal;
	if (!modal || modal.editing === editing) {
		return;
	}
	if (!editing) {
		this.touchModalTiddler();
	}
	modal.editing = editing;
	this.renderModal();
	if (editing) {
		var area = modal.content.querySelector("textarea, input");
		area && area.focus();
	}
};

/*
Editing in the viewer writes straight to the tiddler; once done, stamp it
as modified like the regular editor would.
*/
methods.touchModalTiddler = function() {
	var modal = this.modal;
	if (!modal || !modal.editing) {
		return;
	}
	var tiddler = this.wiki.getTiddler(modal.title);
	if (tiddler && tiddler.fields.text !== modal.textBefore) {
		this.wiki.addTiddler(new $tw.Tiddler(tiddler, this.wiki.getModificationFields()));
	}
};

methods.refreshModal = function(changes) {
	if (this.modal && this.modal.widget) {
		this.modal.widget.refresh(changes);
	}
};

methods.closeModal = function() {
	var modal = this.modal;
	if (modal) {
		this.touchModalTiddler();
		this.modal = null;
		Dom.remove(modal.el);
		if (!this.destroyed) {
			this.root.focus({preventScroll: true});
		}
	}
};

/*** Build and exit effects ***/

methods.effectsEntry = function(key, create) {
	var id = key.substr(2);
	if (key.charAt(0) === "s") {
		return Model.findShape(this.data, id);
	}
	if (!this.data.cards[id] && create) {
		this.data.cards[id] = {};
	}
	return this.data.cards[id] || null;
};

methods.openEffects = function(key) {
	this.closeChooser();
	this.closeEffects();
	this.effects = {key: key, el: Dom.el(this.document, "div", {"class": "pb-popup pb-effects pb-chrome"})};
	this.root.appendChild(this.effects.el);
	this.renderEffects();
	this.positionPopups();
};

methods.closeEffects = function() {
	if (this.effects) {
		Dom.remove(this.effects.el);
		this.effects = null;
	}
};

methods.renderEffects = function() {
	var self = this, doc = this.document;
	var key = this.effects.key;
	var entry = this.effectsEntry(key, false) || {};
	var steps = this.data.steps;
	var el = this.effects.el;
	var select = function(field, noneLabel) {
		var sel = Dom.el(doc, "select", {"class": "pb-select"});
		sel.appendChild(Dom.el(doc, "option", {value: "", text: noneLabel}));
		steps.forEach(function(step, i) {
			sel.appendChild(Dom.el(doc, "option", {value: step.id, text: (i + 1) + " \u00b7 " + self.stepTitle(step)}));
		});
		sel.value = entry[field] && steps.some(function(s) { return s.id === entry[field]; }) ? entry[field] : "";
		sel.addEventListener("change", function() {
			self.checkpoint();
			var target = self.effectsEntry(key, true);
			if (sel.value) {
				target[field] = sel.value;
			} else {
				delete target[field];
			}
			self.commit();
			self.renderEffects();
		});
		return sel;
	};
	Dom.clear(el);
	el.appendChild(Dom.el(doc, "div", {"class": "pb-popup-head"}, [
		Dom.el(doc, "strong", {text: "During the presentation"}),
		Dom.button(doc, "close", "Close", function() { self.closeEffects(); }, "pb-btn-small")
	]));
	if (steps.length === 0) {
		el.appendChild(Dom.el(doc, "p", {"class": "pb-empty", text: "Add stops to the presentation path first."}));
		return;
	}
	el.appendChild(Dom.el(doc, "label", {"class": "pb-field-row"}, ["Appears at", select("build", "From the start")]));
	el.appendChild(Dom.el(doc, "label", {"class": "pb-field-row"}, ["Disappears at", select("exit", "Never")]));
	el.appendChild(Dom.el(doc, "p", {"class": "pb-empty",
		text: "Shapes lying on top of a card or shape also vanish while the presentation shows what they cover."}));
};
