/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/camera.js
type: application/javascript
module-type: library

Camera math for the Pinboard. Written without any TiddlyWiki dependency:
exported presentations embed this file verbatim.

A camera is {x, y, s, r}: a board point p appears on screen at
rotate(r)(p * s) + (x, y), with r in degrees.

\*/

"use strict";

var DEG = Math.PI / 180;

function rotate(x, y, deg) {
	if (!deg) {
		return {x: x, y: y};
	}
	var a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
	return {x: x * c - y * s, y: x * s + y * c};
}
exports.rotate = rotate;

exports.transform = function(c) {
	return "translate(" + c.x + "px," + c.y + "px) rotate(" + (c.r || 0) + "deg) scale(" + c.s + ")";
};

exports.toWorld = function(c, sx, sy) {
	var p = rotate(sx - c.x, sy - c.y, -(c.r || 0));
	return {x: p.x / c.s, y: p.y / c.s};
};

exports.toScreen = function(c, x, y) {
	var p = rotate(x * c.s, y * c.s, c.r || 0);
	return {x: p.x + c.x, y: p.y + c.y};
};

/*
Camera showing board point (cx, cy) in the middle of the view.
*/
exports.cameraAt = function(cx, cy, s, r, viewW, viewH) {
	var p = rotate(cx * s, cy * s, r || 0);
	return {s: s, r: r || 0, x: viewW / 2 - p.x, y: viewH / 2 - p.y};
};

/*
Camera that fits `rect` (rotated by `rot` degrees around its center) into
the view, turning the view so the rectangle appears upright.
*/
exports.fitRect = function(rect, viewW, viewH, padding, maxScale, rot) {
	padding = padding === undefined ? 0.08 : padding;
	var w = Math.max(rect.w, 1), h = Math.max(rect.h, 1);
	var s = Math.min(viewW * (1 - 2 * padding) / w, viewH * (1 - 2 * padding) / h);
	if (maxScale) {
		s = Math.min(s, maxScale);
	}
	s = Math.max(s, 0.02);
	return exports.cameraAt(rect.x + rect.w / 2, rect.y + rect.h / 2, s, rot ? -rot : 0, viewW, viewH);
};

/*
Axis-aligned board rectangle covering what the camera shows.
*/
exports.viewRect = function(c, viewW, viewH) {
	var corners = [[0, 0], [viewW, 0], [0, viewH], [viewW, viewH]].map(function(p) {
		return exports.toWorld(c, p[0], p[1]);
	});
	var xs = corners.map(function(p) { return p.x; });
	var ys = corners.map(function(p) { return p.y; });
	var x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
	return {x: x, y: y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y};
};

exports.zoomAt = function(c, factor, sx, sy, minScale, maxScale) {
	var s = Math.min(maxScale || 8, Math.max(minScale || 0.05, c.s * factor));
	var k = s / c.s;
	return {s: s, r: c.r || 0, x: sx - (sx - c.x) * k, y: sy - (sy - c.y) * k};
};

function cosh(x) { return ((x = Math.exp(x)) + 1 / x) / 2; }
function sinh(x) { return ((x = Math.exp(x)) - 1 / x) / 2; }
function tanh(x) { return ((x = Math.exp(2 * x)) - 1) / (x + 1); }

/*
Smooth zoom-and-pan between two cameras, after van Wijk & Nuij,
"Smooth and efficient zooming and panning" (2003): the camera zooms out
while travelling and in again on arrival. Rotation turns along the
shorter way.

Returns a function t (0..1) -> camera, with a suggested `duration` in ms.
*/
exports.interpolate = function(from, to, viewW, viewH, rho) {
	rho = rho || 1.4;
	var rho2 = rho * rho, rho4 = rho2 * rho2;
	var c0 = exports.toWorld(from, viewW / 2, viewH / 2), c1 = exports.toWorld(to, viewW / 2, viewH / 2);
	var ux0 = c0.x, uy0 = c0.y, w0 = viewW / from.s;
	var ux1 = c1.x, uy1 = c1.y, w1 = viewW / to.s;
	var r0 = from.r || 0, dr = ((((to.r || 0) - r0) % 360) + 540) % 360 - 180;
	var dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
	var S, at;
	if (d2 < 1e-12) {
		S = Math.log(w1 / w0) / rho;
		at = function(t) {
			return [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
		};
	} else {
		var d1 = Math.sqrt(d2),
			b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1),
			b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1),
			q0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0),
			q1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
		S = (q1 - q0) / rho;
		at = function(t) {
			var s = t * S,
				coshq0 = cosh(q0),
				u = w0 / (rho2 * d1) * (coshq0 * tanh(rho * s + q0) - sinh(q0));
			return [ux0 + u * dx, uy0 + u * dy, w0 * coshq0 / cosh(rho * s + q0)];
		};
	}
	var fn = function(t) {
		if (t >= 1) {
			return {x: to.x, y: to.y, s: to.s, r: to.r || 0};
		}
		var p = at(t);
		return exports.cameraAt(p[0], p[1], viewW / p[2], r0 + dr * t, viewW, viewH);
	};
	var duration = Math.abs(S) * 1000 * rho / Math.SQRT2;
	duration = isFinite(duration) ? duration : 0;
	duration = Math.max(duration, Math.abs(dr) * 6);
	fn.duration = Math.min(2400, Math.max(500, duration));
	return fn;
};
