/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/presenter.js
type: application/javascript
module-type: library

Presentation mode: the board goes fullscreen and the camera flies along
the presentation path (frames, cards, shapes, saved views), zooming out
while travelling and back in on arrival. Viewers can still pan and zoom
freely; "next" always returns to the path.

\*/

"use strict";

var Dom = require("./dom.js");

var methods = exports.methods = {};

methods.startPresentation = function(index) {
	var self = this, doc = this.document;
	var steps = this.playableSteps();
	if (steps.length === 0) {
		this.toggleSteps(true);
		return;
	}
	if (this.presenting) {
		this.goToStep(index || 0);
		return;
	}
	this.closeModal();
	this.closeChooser();
	this.textEditor && this.finishTextEdit();
	this.cancelGesture();
	this.presenting = true;
	this.savedCamera = this.camera;
	this.presentIndex = -1;
	this.root.classList.add("pb-presenting");
	this.renderSelection();
	this.renderContextBar();
	// Overlay: click zones and a small control bar.
	this.counter = Dom.el(doc, "span", {"class": "pb-present-counter"});
	this.presentTitle = Dom.el(doc, "span", {"class": "pb-present-title"});
	this.presentUi = Dom.el(doc, "div", {"class": "pb-present-ui pb-chrome"}, [
		Dom.el(doc, "div", {"class": "pb-zone pb-zone-left", title: "Previous", onclick: function() { self.prevStep(); }}),
		Dom.el(doc, "div", {"class": "pb-zone pb-zone-right", title: "Next", onclick: function() { self.nextStep(); }}),
		Dom.el(doc, "div", {"class": "pb-present-bar"}, [
			Dom.button(doc, "left", "Previous (←)", function() { self.prevStep(); }),
			Dom.el(doc, "div", {"class": "pb-present-info"}, [this.counter, this.presentTitle]),
			Dom.button(doc, "right", "Next (→, Space)", function() { self.nextStep(); }),
			Dom.button(doc, "fit", "Overview (O)", function() { self.fitAll(true); }),
			Dom.button(doc, "close", "End presentation (Esc)", function() { self.stopPresentation(); })
		])
	]);
	this.root.appendChild(this.presentUi);
	this.onFullscreenChange = function() {
		if (doc.fullscreenElement === self.root) {
			self.wentFullscreen = true;
		} else if (self.wentFullscreen && self.presenting) {
			self.stopPresentation();
		}
		// The viewport changed size: re-aim at the current step.
		setTimeout(function() {
			if (self.presenting && self.presentIndex >= 0) {
				self.goToStep(self.presentIndex, true);
			}
		}, 60);
	};
	doc.addEventListener("fullscreenchange", this.onFullscreenChange);
	this.wentFullscreen = false;
	if (this.root.requestFullscreen && !doc.fullscreenElement) {
		try {
			var promise = this.root.requestFullscreen();
			promise && promise.catch && promise.catch(function() {});
		} catch (e) {}
	}
	this.root.focus({preventScroll: true});
	this.goToStep(Math.max(0, Math.min(steps.length - 1, index || 0)));
};

methods.stopPresentation = function() {
	if (!this.presenting) {
		return;
	}
	var doc = this.document;
	this.presenting = false;
	doc.removeEventListener("fullscreenchange", this.onFullscreenChange);
	if (doc.fullscreenElement === this.root && doc.exitFullscreen) {
		try {
			var promise = doc.exitFullscreen();
			promise && promise.catch && promise.catch(function() {});
		} catch (e) {}
	}
	Dom.remove(this.presentUi);
	this.presentUi = null;
	this.root.classList.remove("pb-presenting");
	for (var id in this.cards) {
		this.cards[id].el.classList.remove("pb-spotlight");
	}
	if (this.savedCamera && !this.destroyed) {
		this.animateCamera(this.savedCamera, 600);
	}
	this.updateUi();
	this.renderSelection();
};

/*
Steps whose target still exists, in order.
*/
methods.playableSteps = function() {
	var self = this;
	return this.data.steps.filter(function(step) {
		return !!self.stepRect(step);
	});
};

methods.goToStep = function(index, instant) {
	var steps = this.playableSteps();
	if (steps.length === 0) {
		return;
	}
	index = Math.max(0, Math.min(steps.length - 1, index));
	this.presentIndex = index;
	var step = steps[index];
	var rect = this.stepRect(step);
	for (var id in this.cards) {
		$tw.utils.toggleClass(this.cards[id].el, "pb-spotlight", step.kind === "card" && step.ref === id);
	}
	this.flyTo(rect, this.stepPadding(step), instant ? false : undefined);
	if (this.counter) {
		this.counter.textContent = (index + 1) + " / " + steps.length;
		this.presentTitle.textContent = this.stepTitle(step);
	}
	if (this.stepsOpen) {
		this.renderSteps();
	}
};

methods.nextStep = function() {
	var steps = this.playableSteps();
	if (this.presentIndex < steps.length - 1) {
		this.goToStep(this.presentIndex + 1);
	} else {
		// Past the end: show the whole board once more.
		this.fitAll(true);
		this.presentIndex = steps.length;
		if (this.counter) {
			this.counter.textContent = "End";
			this.presentTitle.textContent = "Esc to leave";
		}
	}
};

methods.prevStep = function() {
	this.goToStep(Math.min(this.presentIndex, this.playableSteps().length) - 1);
};

methods.handlePresentationKey = function(event) {
	var handled = true;
	switch (event.key) {
	case "ArrowRight":
	case "ArrowDown":
	case "PageDown":
	case " ":
	case "Enter":
		this.nextStep();
		break;
	case "ArrowLeft":
	case "ArrowUp":
	case "PageUp":
	case "Backspace":
		this.prevStep();
		break;
	case "Home":
		this.goToStep(0);
		break;
	case "End":
		this.goToStep(this.playableSteps().length - 1);
		break;
	case "o":
	case "O":
		this.fitAll(true);
		break;
	case "Escape":
		this.stopPresentation();
		break;
	default:
		handled = false;
	}
	if (handled) {
		event.preventDefault();
		event.stopPropagation();
	}
};
