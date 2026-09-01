window.__ModuleLoader__.load({
	id: "dsh-ba-click-fx",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
//#region src/overlay-compositing.js
/**
* 网页透明覆盖层的最终载荷合同。
*
* Unity 的 FX_Touch 在已知 HDR 场景中使用真正的 Add；未知网页背景只能
* 传输一个满足预乘约束的近似载荷。因此 Alpha 策略和颜色补偿必须保持独立。
*/
const OVERLAY_ALPHA_POLICIES = Object.freeze(["coverage", "visual-max"]);
const OVERLAY_COLOR_COMPENSATIONS = Object.freeze(["none", "bright-core"]);
const BRIGHT_CORE_CHANNEL_MIX = .35;
function clamp01$6(value) {
	return Math.max(0, Math.min(1, Number(value) || 0));
}
function smoothstep$3(edge0, edge1, value) {
	const progress = clamp01$6((value - edge0) / (edge1 - edge0));
	return progress * progress * (3 - 2 * progress);
}
function isOverlayAlphaPolicy(value) {
	return OVERLAY_ALPHA_POLICIES.includes(value);
}
function normalizeOverlayAlphaPolicy(value, fallback = "coverage") {
	return isOverlayAlphaPolicy(value) ? value : fallback;
}
function isOverlayColorCompensation(value) {
	return OVERLAY_COLOR_COMPENSATIONS.includes(value);
}
function normalizeOverlayColorCompensation(value, fallback = "none") {
	return isOverlayColorCompensation(value) ? value : fallback;
}
/**
* 只补齐高能像素的弱通道。最大通道和 Alpha 都保持不变，避免浅色背景
* 补偿把蓝青核心压成纯白；绝对能量门继续保护低能拖尾。
*/
function compensateBrightCorePremultipliedRgb(rgb, alpha, opacity = 1) {
	const safeAlpha = clamp01$6(alpha);
	if (safeAlpha <= 1e-6) return [
		0,
		0,
		0
	];
	const color = [
		0,
		1,
		2
	].map((channel) => Math.min(safeAlpha, Math.max(0, Number(rgb?.[channel]) || 0)));
	const maximum = Math.max(...color);
	if (maximum <= 1e-6) return color;
	const safeOpacity = Math.max(clamp01$6(opacity), 1e-6);
	const normalizedCoverage = clamp01$6(safeAlpha / safeOpacity);
	const normalizedEnergy = maximum / safeOpacity;
	const gate = smoothstep$3(.25, .75, normalizedEnergy / Math.max(normalizedCoverage, 1e-6)) * smoothstep$3(.03125, .25, normalizedEnergy);
	const amount = BRIGHT_CORE_CHANNEL_MIX * gate;
	return color.map((channel) => channel + (maximum - channel) * amount);
}
/**
* Canvas ImageData 保存直通道 RGB；先恢复聚合后的预乘载荷，再统一补偿一次。
*/
function applyOverlayColorCompensationToImageData(imageData, compensation = "none", opacity = 1) {
	if (compensation !== "bright-core" || !imageData?.data) return imageData;
	const data = imageData.data;
	for (let index = 0; index + 3 < data.length; index += 4) {
		const alpha = data[index + 3] / 255;
		if (alpha <= 1e-6) continue;
		const compensated = compensateBrightCorePremultipliedRgb([
			data[index] / 255 * alpha,
			data[index + 1] / 255 * alpha,
			data[index + 2] / 255 * alpha
		], alpha, opacity);
		data[index] = Math.round(compensated[0] / alpha * 255);
		data[index + 1] = Math.round(compensated[1] / alpha * 255);
		data[index + 2] = Math.round(compensated[2] / alpha * 255);
	}
	return imageData;
}
/**
* 对 Canvas 最终 ImageData 执行 visual-max。Canvas 回读的是直通道 RGB，
* 因此先还原当前预乘载荷，再以新的 Alpha 容量重新编码，不能只改 A 通道。
*/
function applyOverlayAlphaPolicyToImageData(imageData, sceneAlphaData = null, bloomAlphaData = null, alphaLimit = 1, policy = "coverage", bloomCompositing = "lighter") {
	if (policy !== "visual-max" || !imageData?.data || !Number.isFinite(imageData.width) || !Number.isFinite(imageData.height)) return imageData;
	const data = imageData.data;
	const safeLimit = Math.max(0, Math.min(1, Number(alphaLimit) || 0));
	for (let index = 0; index + 3 < data.length; index += 4) {
		const currentAlpha = data[index + 3] / 255;
		const sceneAlpha = sceneAlphaData?.[index + 3] === void 0 ? currentAlpha : sceneAlphaData[index + 3] / 255;
		let bloomAlpha;
		if (bloomAlphaData?.[index + 3] !== void 0) bloomAlpha = bloomAlphaData[index + 3] / 255;
		else if (bloomCompositing === "source-over") bloomAlpha = sceneAlpha >= 1 ? 0 : Math.max(0, Math.min(1, (currentAlpha - sceneAlpha) / Math.max(1 - sceneAlpha, 1e-6)));
		else bloomAlpha = Math.max(0, currentAlpha - sceneAlpha);
		const targetAlpha = Math.min(Math.max(sceneAlpha, bloomAlpha), safeLimit);
		if (targetAlpha <= 1e-5) {
			data[index] = 0;
			data[index + 1] = 0;
			data[index + 2] = 0;
			data[index + 3] = 0;
			continue;
		}
		const currentPremultiplied = [
			data[index] / 255 * currentAlpha,
			data[index + 1] / 255 * currentAlpha,
			data[index + 2] / 255 * currentAlpha
		];
		const maximumPremultiplied = Math.max(...currentPremultiplied);
		const capacityScale = Math.min(1, targetAlpha / Math.max(maximumPremultiplied, 1e-6));
		data[index] = Math.round(currentPremultiplied[0] * capacityScale / targetAlpha * 255);
		data[index + 1] = Math.round(currentPremultiplied[1] * capacityScale / targetAlpha * 255);
		data[index + 2] = Math.round(currentPremultiplied[2] * capacityScale / targetAlpha * 255);
		data[index + 3] = Math.round(targetAlpha * 255);
	}
	return imageData;
}
//#endregion
//#region src/webgpu-hdr-presentation.js
const WEBGPU_HDR_PRESENTATION_DEFAULTS = Object.freeze({
	peak: 3,
	brightness: 1,
	colorPreservation: 0,
	whiteCore: .6,
	whiteStart: 1,
	whiteEnd: 5
});
//#endregion
//#region src/config.js
const REFERENCE_HEIGHT = 1080;
const WORLD_TO_REFERENCE_PIXELS = REFERENCE_HEIGHT / 2;
const SHARD_UNIT_TO_REFERENCE_PIXELS = WORLD_TO_REFERENCE_PIXELS * .3078824;
const RING_MESH_OUTER_RADIUS = 1.0636684;
const DEFAULT_EFFECT_BACKEND = "webgl2";
const EFFECT_BACKENDS = /* @__PURE__ */ new Set([
	"canvas2d",
	"webgl2",
	"webgpu",
	"auto"
]);
const DEFAULT_BLOOM_BACKEND = "webgl2";
const BLOOM_BACKENDS = /* @__PURE__ */ new Set([
	"auto",
	"software",
	"webgl2",
	"native"
]);
const INPUT_SOURCES = /* @__PURE__ */ new Set(["dom", "manual"]);
const DEFAULT_OUTPUT_COMPOSITING = "scene";
const OUTPUT_COMPOSITING_MODES = /* @__PURE__ */ new Set(["scene", "browser-overlay"]);
const DEFAULT_OVERLAY_ALPHA_LIMIT = 250 / 255;
const DEFAULT_HOST_COMPOSITING = "source-over";
const HOST_COMPOSITING_MODES = /* @__PURE__ */ new Set([
	"source-over",
	"screen",
	"plus-lighter"
]);
const DEFAULT_HOST_COMPOSITING_SURFACE = "dom-backdrop";
const HOST_COMPOSITING_SURFACES = /* @__PURE__ */ new Set([
	"dom-backdrop",
	"transparent-window",
	"native"
]);
const DEFAULT_OVERLAY_ALPHA_POLICY = "coverage";
const DEFAULT_OVERLAY_COLOR_COMPENSATION = "none";
const WEBGPU_HDR_PEAK_MIN = 2;
const WEBGPU_HDR_PEAK_MAX = 4;
const WEBGPU_HDR_BRIGHTNESS_MAX = 32;
const WEBGPU_HDR_WHITE_THRESHOLD_MIN = 0;
const WEBGPU_HDR_WHITE_START_MAX = 15.99;
const WEBGPU_HDR_WHITE_END_MAX = 16;
const WEBGPU_HDR_WHITE_THRESHOLD_STEP = .01;
const DEFAULT_THEME_COLOR = "#4ca7ff";
const DEFAULT_THEME_COLOR_MODE = "relative-oklch";
const THEME_COLOR_MODES = /* @__PURE__ */ new Set(["hue-only", "relative-oklch"]);
const SIZE_CORRECTION = 1;
/**
* FX_Touch 的 Unity 2021.3 粒子参数。
*
* 数值统一换算到 1920x1080 画面中的 CSS 像素；运行时只按画面高度缩放。
* 这里保留游戏参数而不是暴露调色面板，避免演示页和运行逻辑再次产生两套真值。
*/
const UNITY_FX_TOUCH = Object.freeze({
	referenceHeight: REFERENCE_HEIGHT,
	rootDurationMs: 1e3,
	hit: {
		enabled: false,
		lifetimeMs: 80,
		radius: 24,
		colorKeys: [
			[0, [
				255,
				255,
				255
			]],
			[.5, [
				180,
				220,
				255
			]],
			[1, [
				61,
				100,
				255
			]]
		],
		alphaKeys: [
			[0, 1],
			[.4, .8],
			[1, 0]
		]
	},
	flare: {
		enabled: false,
		lifetimeMs: 150,
		radius: 36,
		rayCount: 6,
		colorKeys: [
			[0, [
				255,
				255,
				255
			]],
			[.3, [
				180,
				220,
				255
			]],
			[1, [
				61,
				100,
				255
			]]
		],
		alphaKeys: [
			[0, .7],
			[.5, .3],
			[1, 0]
		]
	},
	disk: {
		lifetimeMs: 200,
		radius: .12 * WORLD_TO_REFERENCE_PIXELS,
		colorKeys: [[0, [
			255,
			255,
			255
		]], [.1205921, [
			.24056602 * 255,
			99.60762825,
			255
		]]],
		alphaKeys: [
			[0, 1],
			[.1088273, 1],
			[1, 0]
		],
		sizeKeys: [
			[
				0,
				.32583582,
				2.4004734,
				2.4004734
			],
			[
				.21392822,
				.7159773,
				.9115745,
				.9115745
			],
			[
				1,
				1,
				0,
				0
			]
		],
		textureRadialEnergyKeys: [
			[0, 1],
			[.84, 1],
			[.88, 1],
			[.885, .127021063],
			[.89, .029392051],
			[.895, .010453372],
			[.9, .003970262],
			[.905, 231299e-9],
			[.91, 26848e-9],
			[.915, 2303e-9],
			[.92, 0],
			[1, 0]
		]
	},
	rings: {
		count: 2,
		lifetimeMs: 600,
		radiusMin: .12 * WORLD_TO_REFERENCE_PIXELS * RING_MESH_OUTER_RADIUS,
		radiusMax: .14 * WORLD_TO_REFERENCE_PIXELS * RING_MESH_OUTER_RADIUS,
		bandToOuterRadius: .0598573766034603,
		widthStart: 1,
		widthEnd: 1,
		angularVelocityMultiplier: 11.170107,
		angularVelocityMinKeys: [[.14903903, 1], [1, .45561826]],
		angularVelocityMaxKeys: [[.15865384, .79881656], [1, -.06509134]],
		rotationDirection: -1,
		hdrIntensity: 5.992157,
		colorKeys: [
			[.1117723, [
				255,
				255,
				255
			]],
			[.5000076, [
				.2971698 * 255,
				166.5880575,
				255
			]],
			[1, [
				.2971698 * 255,
				166.5880575,
				255
			]]
		],
		sizeKeys: [
			[
				.007209778,
				.42050898,
				2.4004734,
				2.4004734
			],
			[
				.21392822,
				.7159773,
				.9115745,
				.9115745
			],
			[
				1,
				1,
				0,
				0
			]
		],
		dissolveKeys: [
			[
				0,
				1,
				0,
				0
			],
			[
				.2,
				0,
				0,
				2.4249368
			],
			[
				1,
				1,
				.27735636,
				.27735636
			]
		],
		arcSamples: 96,
		radialSamples: 8,
		textureUvMin: .0005000000237487257,
		textureUvMax: .999500036239624,
		dissolveDirection: 1
	},
	shards: {
		hdrIntensity: 5.992157,
		roundness: 0,
		startColor: [
			.5377358,
			.5377358,
			.5377358
		],
		clickCount: 4,
		clickLifetimeMinMs: 600,
		clickLifetimeMaxMs: 700,
		clickRadius: .3 * SHARD_UNIT_TO_REFERENCE_PIXELS,
		clickSpeedMin: .3 * SHARD_UNIT_TO_REFERENCE_PIXELS,
		clickSpeedMax: .4 * SHARD_UNIT_TO_REFERENCE_PIXELS,
		trailLifetimeMinMs: 200,
		trailLifetimeMaxMs: 400,
		trailRadius: .15 * SHARD_UNIT_TO_REFERENCE_PIXELS,
		trailSpeedMin: .2 * SHARD_UNIT_TO_REFERENCE_PIXELS,
		trailSpeedMax: .3 * SHARD_UNIT_TO_REFERENCE_PIXELS,
		sizeMin: .1 * SHARD_UNIT_TO_REFERENCE_PIXELS,
		sizeMax: .2 * SHARD_UNIT_TO_REFERENCE_PIXELS,
		sizeKeys: [
			[
				0,
				0,
				0,
				0
			],
			[
				.15445095,
				1,
				0,
				0
			],
			[
				1,
				0,
				-2.1621501,
				-2.1621501
			]
		],
		textureFrames: [[
			[-.48046875, -.36328125],
			[.48046875, -.36328125],
			[0, .45703125]
		], [
			[0, -.45703125],
			[.48046875, .36328125],
			[-.48046875, .36328125]
		]],
		colorKeys: [
			[0, [
				255,
				255,
				255
			]],
			[.1823606, [
				255,
				255,
				255
			]],
			[.282353, [
				95.0235825,
				.7731873 * 255,
				255
			]],
			[.4617685, [
				95.00000265,
				197.0000205,
				255
			]],
			[.6617685, [
				90.000006,
				186.000009,
				.9450981 * 255
			]],
			[.8264744, [
				95.00000265,
				197.0000205,
				255
			]],
			[1, [
				95.00000265,
				197.0000205,
				255
			]]
		],
		alphaKeys: [
			[0, 1],
			[.2882429, 1],
			[.3647059, 0],
			[.4705882, 1],
			[.5735256, 0],
			[.6676432, 1],
			[.7558862, 0],
			[.8529488, 1],
			[1, 1]
		],
		trailSpacing: WORLD_TO_REFERENCE_PIXELS / 5,
		maxCount: 50
	},
	trail: {
		lifetimeMs: 300,
		geometryWidth: .005 * WORLD_TO_REFERENCE_PIXELS,
		width: .005 * WORLD_TO_REFERENCE_PIXELS,
		minVertexDistance: .01 * WORLD_TO_REFERENCE_PIXELS,
		numCornerVertices: 4,
		numCapVertices: 1,
		outerGlowWidth: 9,
		trailOpacity: 1,
		gradient: [
			[0, [
				0,
				0,
				0
			]],
			[.5794156, [
				0,
				24.191827,
				72
			]],
			[.97941558, [
				0,
				99.598249,
				255
			]],
			[1, [
				0,
				99.598249,
				255
			]]
		],
		coverageLongitudinalKeys: [
			[0, 0],
			[.248532, 0],
			[.97941558, 1],
			[1, 1]
		],
		textureLongitudinalKeys: [
			[0, 0],
			[.248532, 0],
			[.311155, .002428251],
			[.373777, .021219072],
			[.436399, .068478133],
			[.499022, .144128269],
			[.561644, .462077113],
			[.624266, .672443723],
			[.686888, .791298368],
			[.749511, .930109875],
			[.812133, 1],
			[1, 1]
		],
		textureTransverseProfileKeys: [
			[0, [
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0
			]],
			[.248532, [
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0
			]],
			[.311155, [
				1,
				1,
				.625,
				0,
				0,
				0,
				0,
				0,
				0
			]],
			[.373777, [
				1,
				1,
				.7167,
				.3534,
				.1144,
				0,
				0,
				0,
				0
			]],
			[.436399, [
				1,
				1,
				.7956,
				.5387,
				.283,
				.0757,
				0,
				0,
				0
			]],
			[.499022, [
				1,
				.9605,
				.8657,
				.6613,
				.4191,
				.1786,
				.0279,
				0,
				0
			]],
			[.561644, [
				1,
				1,
				.9277,
				.4599,
				.2906,
				.1564,
				.0591,
				.0013,
				.0026
			]],
			[.624266, [
				1,
				.9687,
				.9534,
				.8881,
				.6621,
				.2342,
				.1006,
				.0149,
				.0018
			]],
			[.686888, [
				1,
				.9804,
				.9515,
				.8952,
				.8188,
				.5912,
				.1858,
				.0382,
				.0019
			]],
			[.749511, [
				1,
				1,
				.9457,
				.9018,
				.8341,
				.723,
				.4968,
				.0699,
				.0016
			]],
			[.812133, [
				1,
				1,
				.9734,
				.9647,
				.9047,
				.7991,
				.6724,
				.1896,
				.0015
			]],
			[.874755, [
				1,
				1,
				1,
				1,
				.9734,
				.9301,
				.7991,
				.4022,
				.0015
			]],
			[.937378, [
				1,
				1,
				1,
				1,
				1,
				1,
				.9301,
				.5,
				.0015
			]],
			[1, [
				1,
				1,
				1,
				1,
				1,
				1,
				.9867,
				.591,
				.0015
			]]
		]
	},
	bloom: {
		threshold: 1,
		softKnee: 0,
		clamp: 65472,
		intensity: 1.7,
		diffusion: 7,
		resolutionScale: .5,
		emissionRange: 23.968628,
		diskEmission: 2,
		trailEmission: 23.968628,
		trailCoverageScale: 1,
		trailEmissionAlpha: 1,
		clickEmissionScale: 1,
		ringEmissionAlpha: 1,
		diskEmissionAlpha: 1,
		ringBlur: 80,
		ringAlpha: .35,
		diskBlur: 65,
		diskAlpha: .65,
		trailAlpha: .18
	}
});
const FX_PARAM_SCHEMA_VERSION = 2;
const FX_PARAM_GROUP_ORDERS = Object.freeze({
	hit: 10,
	flare: 20,
	disk: 30,
	rings: 40,
	shards: 50,
	trail: 60,
	bloom: 70
});
const FX_PARAM_ORDERS = Object.freeze({
	"hit.enabled": 10,
	"hit.lifetimeMs": 20,
	"hit.radius": 30,
	"flare.enabled": 40,
	"flare.lifetimeMs": 50,
	"flare.radius": 60,
	"flare.rayCount": 70,
	"disk.lifetimeMs": 80,
	"disk.radius": 90,
	"rings.count": 100,
	"rings.lifetimeMs": 110,
	"rings.radiusMin": 120,
	"rings.radiusMax": 130,
	"rings.bandToOuterRadius": 140,
	"rings.widthStart": 150,
	"rings.widthEnd": 160,
	"rings.angularVelocityMultiplier": 170,
	"rings.rotationDirection": 180,
	"rings.hdrIntensity": 190,
	"rings.arcSamples": 200,
	"rings.radialSamples": 210,
	"rings.dissolveDirection": 220,
	"shards.hdrIntensity": 230,
	"shards.clickCount": 240,
	"shards.clickLifetimeMinMs": 250,
	"shards.clickLifetimeMaxMs": 260,
	"shards.clickRadius": 270,
	"shards.clickSpeedMin": 280,
	"shards.clickSpeedMax": 290,
	"shards.roundness": 295,
	"shards.trailLifetimeMinMs": 300,
	"shards.trailLifetimeMaxMs": 310,
	"shards.trailRadius": 320,
	"shards.trailSpeedMin": 330,
	"shards.trailSpeedMax": 340,
	"shards.sizeMin": 350,
	"shards.sizeMax": 360,
	"shards.trailSpacing": 370,
	"shards.maxCount": 380,
	"trail.lifetimeMs": 390,
	"trail.geometryWidth": 400,
	"trail.width": 410,
	"trail.minVertexDistance": 420,
	"trail.numCornerVertices": 430,
	"trail.numCapVertices": 440,
	"trail.outerGlowWidth": 450,
	"trail.trailOpacity": 460,
	"bloom.threshold": 470,
	"bloom.softKnee": 480,
	"bloom.clamp": 490,
	"bloom.intensity": 500,
	"bloom.diffusion": 510,
	"bloom.resolutionScale": 520,
	"bloom.emissionRange": 530,
	"bloom.diskEmission": 540,
	"bloom.trailEmission": 550,
	"bloom.trailCoverageScale": 560,
	"bloom.trailEmissionAlpha": 570,
	"bloom.clickEmissionScale": 580,
	"bloom.ringEmissionAlpha": 590,
	"bloom.diskEmissionAlpha": 600,
	"bloom.ringBlur": 610,
	"bloom.ringAlpha": 620,
	"bloom.diskBlur": 630,
	"bloom.diskAlpha": 640,
	"bloom.trailAlpha": 650
});
const FX_PARAM_DISPLAY_RANGES = Object.freeze({
	"hit.lifetimeMs": [
		20,
		200,
		1
	],
	"hit.radius": [
		10,
		60,
		.01
	],
	"flare.lifetimeMs": [
		50,
		300,
		1
	],
	"flare.radius": [
		10,
		80,
		.01
	],
	"flare.rayCount": [
		3,
		12,
		1
	],
	"disk.lifetimeMs": [
		50,
		500,
		1
	],
	"disk.radius": [
		20,
		120,
		.01
	],
	"rings.count": [
		0,
		6,
		1
	],
	"rings.lifetimeMs": [
		50,
		2e3,
		1
	],
	"rings.radiusMin": [
		20,
		120,
		.01
	],
	"rings.radiusMax": [
		20,
		120,
		.01
	],
	"rings.bandToOuterRadius": [
		.01,
		.2,
		1e-4
	],
	"rings.widthStart": [
		.25,
		2,
		.01
	],
	"rings.widthEnd": [
		.25,
		2,
		.01
	],
	"rings.angularVelocityMultiplier": [
		1,
		30,
		.01
	],
	"rings.rotationDirection": [
		-1,
		1,
		2
	],
	"rings.hdrIntensity": [
		0,
		8,
		.01
	],
	"rings.arcSamples": [
		24,
		192,
		1
	],
	"rings.radialSamples": [
		2,
		16,
		1
	],
	"rings.dissolveDirection": [
		-1,
		1,
		2
	],
	"shards.hdrIntensity": [
		0,
		8,
		.01
	],
	"shards.clickCount": [
		0,
		12,
		1
	],
	"shards.clickLifetimeMinMs": [
		100,
		1e3,
		1
	],
	"shards.clickLifetimeMaxMs": [
		100,
		1e3,
		1
	],
	"shards.clickRadius": [
		0,
		200,
		.01
	],
	"shards.clickSpeedMin": [
		0,
		200,
		.01
	],
	"shards.clickSpeedMax": [
		0,
		200,
		.01
	],
	"shards.roundness": [
		0,
		1,
		.01
	],
	"shards.trailLifetimeMinMs": [
		50,
		500,
		1
	],
	"shards.trailLifetimeMaxMs": [
		50,
		500,
		1
	],
	"shards.trailRadius": [
		0,
		100,
		.01
	],
	"shards.trailSpeedMin": [
		0,
		150,
		.01
	],
	"shards.trailSpeedMax": [
		0,
		150,
		.01
	],
	"shards.sizeMin": [
		0,
		100,
		.01
	],
	"shards.sizeMax": [
		0,
		100,
		.01
	],
	"shards.trailSpacing": [
		10,
		500,
		.01
	],
	"shards.maxCount": [
		0,
		500,
		1
	],
	"trail.lifetimeMs": [
		50,
		2e3,
		1
	],
	"trail.geometryWidth": [
		1,
		8,
		.01
	],
	"trail.width": [
		1,
		25,
		.01
	],
	"trail.minVertexDistance": [
		1,
		20,
		.01
	],
	"trail.numCornerVertices": [
		0,
		12,
		1
	],
	"trail.numCapVertices": [
		0,
		6,
		1
	],
	"trail.outerGlowWidth": [
		1,
		40,
		.1
	],
	"trail.trailOpacity": [
		0,
		1,
		.01
	],
	"bloom.threshold": [
		0,
		5,
		.01
	],
	"bloom.softKnee": [
		0,
		1,
		.01
	],
	"bloom.clamp": [
		1,
		65504,
		1
	],
	"bloom.intensity": [
		0,
		2,
		.01
	],
	"bloom.diffusion": [
		0,
		10,
		.01
	],
	"bloom.resolutionScale": [
		.1,
		.75,
		.01
	],
	"bloom.emissionRange": [
		1,
		64,
		.01
	],
	"bloom.diskEmission": [
		0,
		8,
		.01
	],
	"bloom.trailEmission": [
		0,
		64,
		.01
	],
	"bloom.trailCoverageScale": [
		0,
		4,
		.01
	],
	"bloom.trailEmissionAlpha": [
		0,
		1,
		.01
	],
	"bloom.clickEmissionScale": [
		0,
		4,
		.01
	],
	"bloom.ringEmissionAlpha": [
		0,
		1,
		.01
	],
	"bloom.diskEmissionAlpha": [
		0,
		1,
		.01
	],
	"bloom.ringBlur": [
		0,
		200,
		.1
	],
	"bloom.ringAlpha": [
		0,
		1,
		.01
	],
	"bloom.diskBlur": [
		0,
		200,
		.1
	],
	"bloom.diskAlpha": [
		0,
		1,
		.01
	],
	"bloom.trailAlpha": [
		0,
		1,
		.01
	]
});
const FX_PARAM_LINKS = Object.freeze({
	"rings.radiusMin": ["rings.radiusMax"],
	"rings.radiusMax": ["rings.radiusMin"],
	"rings.widthStart": ["rings.widthEnd"],
	"rings.widthEnd": ["rings.widthStart"],
	"shards.clickLifetimeMinMs": ["shards.clickLifetimeMaxMs"],
	"shards.clickLifetimeMaxMs": ["shards.clickLifetimeMinMs"],
	"shards.clickSpeedMin": ["shards.clickSpeedMax"],
	"shards.clickSpeedMax": ["shards.clickSpeedMin"],
	"shards.trailLifetimeMinMs": ["shards.trailLifetimeMaxMs"],
	"shards.trailLifetimeMaxMs": ["shards.trailLifetimeMinMs"],
	"shards.trailSpeedMin": ["shards.trailSpeedMax"],
	"shards.trailSpeedMax": ["shards.trailSpeedMin"],
	"shards.sizeMin": ["shards.sizeMax"],
	"shards.sizeMax": ["shards.sizeMin"]
});
function freezeFxParamMetadata(value) {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) freezeFxParamMetadata(child);
	return Object.freeze(value);
}
function createFxParamDescriptor(path, type, options = {}) {
	const keys = path.split(".");
	let defaultValue = UNITY_FX_TOUCH;
	for (const key of keys) defaultValue = defaultValue[key];
	return {
		path,
		type,
		default: defaultValue,
		...options
	};
}
function finalizeFxParamDescriptor(descriptor) {
	const group = descriptor.path.split(".")[0];
	const displayRange = FX_PARAM_DISPLAY_RANGES[descriptor.path];
	const result = {
		...descriptor,
		order: FX_PARAM_ORDERS[descriptor.path],
		group,
		groupOrder: FX_PARAM_GROUP_ORDERS[group],
		labelKey: `baClickFx.params.${descriptor.path}`,
		groupLabelKey: `baClickFx.paramGroups.${group}`,
		linkedParams: FX_PARAM_LINKS[descriptor.path] ?? []
	};
	if (displayRange) result.display = {
		min: displayRange[0],
		max: displayRange[1],
		step: displayRange[2]
	};
	return result;
}
/**
* 可由宿主安全修改的公开标量参数。曲线、颜色键与纹理采样数据仍由
* Unity 资源真值独占，避免通用配置界面破坏渲染器之间的共同契约。
*/
const FX_PARAM_SCHEMA = freezeFxParamMetadata([
	createFxParamDescriptor("hit.enabled", "boolean", { unit: "boolean" }),
	createFxParamDescriptor("hit.lifetimeMs", "number", {
		min: 1,
		max: 1e4,
		step: 1,
		unit: "ms"
	}),
	createFxParamDescriptor("hit.radius", "number", {
		min: 1,
		max: 2e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("flare.enabled", "boolean", { unit: "boolean" }),
	createFxParamDescriptor("flare.lifetimeMs", "number", {
		min: 1,
		max: 1e4,
		step: 1,
		unit: "ms"
	}),
	createFxParamDescriptor("flare.radius", "number", {
		min: 1,
		max: 2e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("flare.rayCount", "number", {
		min: 1,
		max: 64,
		step: 1,
		unit: "count"
	}),
	createFxParamDescriptor("disk.lifetimeMs", "number", {
		min: 1,
		max: 1e4,
		step: 1,
		unit: "ms"
	}),
	createFxParamDescriptor("disk.radius", "number", {
		min: 1,
		max: 2e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("rings.count", "number", {
		min: 0,
		max: 64,
		step: 1,
		unit: "count"
	}),
	createFxParamDescriptor("rings.lifetimeMs", "number", {
		min: 1,
		max: 1e4,
		step: 1,
		unit: "ms"
	}),
	createFxParamDescriptor("rings.radiusMin", "number", {
		min: 0,
		max: 2e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("rings.radiusMax", "number", {
		min: 0,
		max: 2e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("rings.bandToOuterRadius", "number", {
		min: 0,
		max: 1,
		step: 1e-4,
		unit: "ratio"
	}),
	createFxParamDescriptor("rings.widthStart", "number", {
		min: 0,
		max: 8,
		step: .01,
		unit: "multiplier"
	}),
	createFxParamDescriptor("rings.widthEnd", "number", {
		min: 0,
		max: 8,
		step: .01,
		unit: "multiplier"
	}),
	createFxParamDescriptor("rings.angularVelocityMultiplier", "number", {
		min: 0,
		max: 100,
		step: .01,
		unit: "multiplier"
	}),
	createFxParamDescriptor("rings.rotationDirection", "number", {
		min: -1,
		max: 1,
		step: 2,
		unit: "direction"
	}),
	createFxParamDescriptor("rings.hdrIntensity", "number", {
		min: 0,
		max: 64,
		step: .01,
		unit: "linear-hdr"
	}),
	createFxParamDescriptor("rings.arcSamples", "number", {
		min: 3,
		max: 1024,
		step: 1,
		unit: "samples"
	}),
	createFxParamDescriptor("rings.radialSamples", "number", {
		min: 1,
		max: 32,
		step: 1,
		unit: "samples"
	}),
	createFxParamDescriptor("rings.dissolveDirection", "number", {
		min: -1,
		max: 1,
		step: 2,
		unit: "direction"
	}),
	createFxParamDescriptor("shards.hdrIntensity", "number", {
		min: 0,
		max: 64,
		step: .01,
		unit: "linear-hdr"
	}),
	createFxParamDescriptor("shards.clickCount", "number", {
		min: 0,
		max: 1e3,
		step: 1,
		unit: "count"
	}),
	createFxParamDescriptor("shards.clickLifetimeMinMs", "number", {
		min: 1,
		max: 1e4,
		step: 1,
		unit: "ms"
	}),
	createFxParamDescriptor("shards.clickLifetimeMaxMs", "number", {
		min: 1,
		max: 1e4,
		step: 1,
		unit: "ms"
	}),
	createFxParamDescriptor("shards.clickRadius", "number", {
		min: 0,
		max: 5e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("shards.clickSpeedMin", "number", {
		min: 0,
		max: 5e3,
		step: .01,
		unit: "px-per-second"
	}),
	createFxParamDescriptor("shards.clickSpeedMax", "number", {
		min: 0,
		max: 5e3,
		step: .01,
		unit: "px-per-second"
	}),
	createFxParamDescriptor("shards.roundness", "number", {
		min: 0,
		max: 1,
		step: .01,
		unit: "ratio"
	}),
	createFxParamDescriptor("shards.trailLifetimeMinMs", "number", {
		min: 1,
		max: 1e4,
		step: 1,
		unit: "ms"
	}),
	createFxParamDescriptor("shards.trailLifetimeMaxMs", "number", {
		min: 1,
		max: 1e4,
		step: 1,
		unit: "ms"
	}),
	createFxParamDescriptor("shards.trailRadius", "number", {
		min: 0,
		max: 5e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("shards.trailSpeedMin", "number", {
		min: 0,
		max: 5e3,
		step: .01,
		unit: "px-per-second"
	}),
	createFxParamDescriptor("shards.trailSpeedMax", "number", {
		min: 0,
		max: 5e3,
		step: .01,
		unit: "px-per-second"
	}),
	createFxParamDescriptor("shards.sizeMin", "number", {
		min: 0,
		max: 2e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("shards.sizeMax", "number", {
		min: 0,
		max: 2e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("shards.trailSpacing", "number", {
		min: 1,
		max: 5e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("shards.maxCount", "number", {
		min: 0,
		max: 1e4,
		step: 1,
		unit: "count"
	}),
	createFxParamDescriptor("trail.lifetimeMs", "number", {
		min: 1,
		max: 1e4,
		step: 1,
		unit: "ms"
	}),
	createFxParamDescriptor("trail.geometryWidth", "number", {
		min: 0,
		max: 1e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("trail.width", "number", {
		min: 0,
		max: 1e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("trail.minVertexDistance", "number", {
		min: 0,
		max: 5e3,
		step: .01,
		unit: "px"
	}),
	createFxParamDescriptor("trail.numCornerVertices", "number", {
		min: 0,
		max: 64,
		step: 1,
		unit: "count"
	}),
	createFxParamDescriptor("trail.numCapVertices", "number", {
		min: 0,
		max: 64,
		step: 1,
		unit: "count"
	}),
	createFxParamDescriptor("trail.outerGlowWidth", "number", {
		min: 0,
		max: 1e3,
		step: .1,
		unit: "px"
	}),
	createFxParamDescriptor("trail.trailOpacity", "number", {
		min: 0,
		max: 1,
		step: .01,
		unit: "ratio"
	}),
	createFxParamDescriptor("bloom.threshold", "number", {
		min: 0,
		max: 64,
		step: .01,
		unit: "gamma-hdr"
	}),
	createFxParamDescriptor("bloom.softKnee", "number", {
		min: 0,
		max: 1,
		step: .01,
		unit: "ratio"
	}),
	createFxParamDescriptor("bloom.clamp", "number", {
		min: 0,
		max: 65504,
		step: 1,
		unit: "gamma-hdr"
	}),
	createFxParamDescriptor("bloom.intensity", "number", {
		min: 0,
		max: 10,
		step: .01,
		unit: "scalar"
	}),
	createFxParamDescriptor("bloom.diffusion", "number", {
		min: 0,
		max: 10,
		step: .01,
		unit: "scalar"
	}),
	createFxParamDescriptor("bloom.resolutionScale", "number", {
		min: .1,
		max: .75,
		step: .01,
		unit: "ratio"
	}),
	createFxParamDescriptor("bloom.emissionRange", "number", {
		min: 1,
		max: 65504,
		step: .01,
		unit: "linear-hdr"
	}),
	createFxParamDescriptor("bloom.diskEmission", "number", {
		min: 0,
		max: 64,
		step: .01,
		unit: "linear-hdr"
	}),
	createFxParamDescriptor("bloom.trailEmission", "number", {
		min: 0,
		max: 65504,
		step: .01,
		unit: "linear-hdr"
	}),
	createFxParamDescriptor("bloom.trailCoverageScale", "number", {
		min: 0,
		max: 8,
		step: .01,
		unit: "multiplier"
	}),
	createFxParamDescriptor("bloom.trailEmissionAlpha", "number", {
		min: 0,
		max: 1,
		step: .01,
		unit: "ratio"
	}),
	createFxParamDescriptor("bloom.clickEmissionScale", "number", {
		min: 0,
		max: 4,
		step: .01,
		unit: "multiplier"
	}),
	createFxParamDescriptor("bloom.ringEmissionAlpha", "number", {
		min: 0,
		max: 1,
		step: .01,
		unit: "ratio"
	}),
	createFxParamDescriptor("bloom.diskEmissionAlpha", "number", {
		min: 0,
		max: 1,
		step: .01,
		unit: "ratio"
	}),
	createFxParamDescriptor("bloom.ringBlur", "number", {
		min: 0,
		max: 1e3,
		step: .1,
		unit: "px"
	}),
	createFxParamDescriptor("bloom.ringAlpha", "number", {
		min: 0,
		max: 1,
		step: .01,
		unit: "ratio"
	}),
	createFxParamDescriptor("bloom.diskBlur", "number", {
		min: 0,
		max: 1e3,
		step: .1,
		unit: "px"
	}),
	createFxParamDescriptor("bloom.diskAlpha", "number", {
		min: 0,
		max: 1,
		step: .01,
		unit: "ratio"
	}),
	createFxParamDescriptor("bloom.trailAlpha", "number", {
		min: 0,
		max: 1,
		step: .01,
		unit: "ratio"
	})
].map(finalizeFxParamDescriptor));
/**
* Schema 版本间的纯数据迁移规则。宿主按版本顺序执行 changes，
* 不需要加载渲染引擎就能升级持久化配置。
*/
const FX_PARAM_MIGRATIONS = freezeFxParamMetadata([{
	fromVersion: 0,
	toVersion: 1,
	changes: [{
		kind: "replace",
		from: "bloom.scatter",
		to: "bloom.diffusion",
		source: {
			type: "number",
			min: 0
		},
		value: UNITY_FX_TOUCH.bloom.diffusion
	}]
}, {
	fromVersion: 1,
	toVersion: 2,
	changes: []
}]);
const CONFIG = Object.freeze({
	scale: 1,
	opacity: 1,
	themeColor: DEFAULT_THEME_COLOR,
	themeColorMode: DEFAULT_THEME_COLOR_MODE,
	clickEnabled: true,
	trailEnabled: true,
	trailAlways: false,
	inputSource: "dom",
	inputSamplingRate: 0,
	clickTimeScale: 1,
	trailTimeScale: 1,
	outputCompositing: DEFAULT_OUTPUT_COMPOSITING,
	overlayAlphaPolicy: DEFAULT_OVERLAY_ALPHA_POLICY,
	overlayColorCompensation: DEFAULT_OVERLAY_COLOR_COMPENSATION,
	overlayAlphaLimit: DEFAULT_OVERLAY_ALPHA_LIMIT,
	hostCompositing: DEFAULT_HOST_COMPOSITING,
	hostCompositingSurface: DEFAULT_HOST_COMPOSITING_SURFACE,
	effectBackend: DEFAULT_EFFECT_BACKEND,
	webgpuPreferHdr: true,
	webgpuHdrPeak: WEBGPU_HDR_PRESENTATION_DEFAULTS.peak,
	webgpuHdrBrightness: WEBGPU_HDR_PRESENTATION_DEFAULTS.brightness,
	webgpuHdrColorPreservation: WEBGPU_HDR_PRESENTATION_DEFAULTS.colorPreservation,
	webgpuHdrWhiteCore: WEBGPU_HDR_PRESENTATION_DEFAULTS.whiteCore,
	webgpuHdrWhiteStart: WEBGPU_HDR_PRESENTATION_DEFAULTS.whiteStart,
	webgpuHdrWhiteEnd: WEBGPU_HDR_PRESENTATION_DEFAULTS.whiteEnd,
	bloomBackend: DEFAULT_BLOOM_BACKEND,
	isolatedCompositing: false,
	lightBackgroundContrastAlpha: 0,
	maxDpr: 1,
	touchAction: "auto"
});
function isEffectBackend(value) {
	return EFFECT_BACKENDS.has(value);
}
function normalizeEffectBackend(value, fallback = DEFAULT_EFFECT_BACKEND) {
	return isEffectBackend(value) ? value : fallback;
}
function isBloomBackend(value) {
	return BLOOM_BACKENDS.has(value);
}
function normalizeBloomBackend(value, fallback = DEFAULT_BLOOM_BACKEND) {
	return isBloomBackend(value) ? value : fallback;
}
function isInputSource(value) {
	return INPUT_SOURCES.has(value);
}
function isInputSamplingRate(value) {
	return value === 0 || Number.isFinite(value) && value >= 1 && value <= 1e3;
}
function isOutputCompositing(value) {
	return OUTPUT_COMPOSITING_MODES.has(value);
}
function normalizeOverlayAlphaPolicyConfig(value, fallback = DEFAULT_OVERLAY_ALPHA_POLICY) {
	return normalizeOverlayAlphaPolicy(value, fallback);
}
function normalizeOverlayColorCompensationConfig(value, fallback = DEFAULT_OVERLAY_COLOR_COMPENSATION) {
	return normalizeOverlayColorCompensation(value, fallback);
}
function isOverlayAlphaLimit(value) {
	return Number.isFinite(value) && value >= 0 && value <= 1;
}
function normalizeOverlayAlphaLimit(value, fallback = DEFAULT_OVERLAY_ALPHA_LIMIT) {
	const safeFallback = Number.isFinite(fallback) ? Math.max(0, Math.min(1, fallback)) : DEFAULT_OVERLAY_ALPHA_LIMIT;
	if (!Number.isFinite(value)) return safeFallback;
	return Math.max(0, Math.min(1, value));
}
function isHostCompositing(value) {
	return HOST_COMPOSITING_MODES.has(value);
}
/**
* Screen 与 plus-lighter 都消费不受 Coverage Alpha 策略约束的完整载荷；
* 区别只发生在宿主背景参与的最后一次 CSS/原生合成。
*/
function isIndependentHostCompositing(value) {
	return value === "screen" || value === "plus-lighter";
}
function normalizeHostCompositing(value, fallback = DEFAULT_HOST_COMPOSITING) {
	return isHostCompositing(value) ? value : fallback;
}
function isHostCompositingSurface(value) {
	return HOST_COMPOSITING_SURFACES.has(value);
}
function normalizeHostCompositingSurface(value, fallback = DEFAULT_HOST_COMPOSITING_SURFACE) {
	return isHostCompositingSurface(value) ? value : fallback;
}
/**
* 将调用方的混合请求与最终宿主表面的能力分开解析。透明窗口后方的
* 桌面不属于 DOM backdrop，CSS Screen/Add 无法跨越窗口合成边界。
*/
function resolveHostCompositing({ outputCompositing = DEFAULT_OUTPUT_COMPOSITING, requestedHostCompositing = DEFAULT_HOST_COMPOSITING, hostCompositingSurface = DEFAULT_HOST_COMPOSITING_SURFACE, hasCompositingReference = false } = {}) {
	const requested = normalizeHostCompositing(requestedHostCompositing);
	const surface = normalizeHostCompositingSurface(hostCompositingSurface);
	const independentRequested = isIndependentHostCompositing(requested);
	if (outputCompositing !== "browser-overlay" || hasCompositingReference || !independentRequested) return {
		resolvedHostCompositing: "source-over",
		compositingWarning: null
	};
	if (surface === "transparent-window") return {
		resolvedHostCompositing: "source-over",
		compositingWarning: `${requested}-requires-visible-backdrop`
	};
	return {
		resolvedHostCompositing: requested,
		compositingWarning: null
	};
}
function isTimeScale(value) {
	return Number.isFinite(value) && value >= .01;
}
function normalizeThemeColor(value, fallback = DEFAULT_THEME_COLOR) {
	if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return fallback;
	return value.toLowerCase();
}
function isThemeColorMode(value) {
	return THEME_COLOR_MODES.has(value);
}
function normalizeThemeColorMode(value, fallback = DEFAULT_THEME_COLOR_MODE) {
	return isThemeColorMode(value) ? value : fallback;
}
function normalizeFiniteRange(value, fallback, minimum, maximum) {
	const safeFallback = Number.isFinite(fallback) ? Math.max(minimum, Math.min(maximum, fallback)) : minimum;
	if (!Number.isFinite(value)) return safeFallback;
	return Math.max(minimum, Math.min(maximum, value));
}
/**
* HDR 展示校准是 WebGPU 输出合同，不属于 Unity FX 参数树。
* 起止阈值始终保留一个滑块步长，避免 WGSL 出现退化 smoothstep。
*/
function normalizeWebGPUHdrPresentation(overrides = {}, fallback = WEBGPU_HDR_PRESENTATION_DEFAULTS) {
	const peak = normalizeFiniteRange(overrides.webgpuHdrPeak, fallback.webgpuHdrPeak ?? fallback.peak, WEBGPU_HDR_PEAK_MIN, WEBGPU_HDR_PEAK_MAX);
	const whiteCore = normalizeFiniteRange(overrides.webgpuHdrWhiteCore, fallback.webgpuHdrWhiteCore ?? fallback.whiteCore, 0, 1);
	const brightness = normalizeFiniteRange(overrides.webgpuHdrBrightness, fallback.webgpuHdrBrightness ?? fallback.brightness, 0, WEBGPU_HDR_BRIGHTNESS_MAX);
	const colorPreservation = normalizeFiniteRange(overrides.webgpuHdrColorPreservation, fallback.webgpuHdrColorPreservation ?? fallback.colorPreservation, 0, 1);
	const whiteStart = normalizeFiniteRange(overrides.webgpuHdrWhiteStart, fallback.webgpuHdrWhiteStart ?? fallback.whiteStart, WEBGPU_HDR_WHITE_THRESHOLD_MIN, WEBGPU_HDR_WHITE_START_MAX);
	const requestedWhiteEnd = normalizeFiniteRange(overrides.webgpuHdrWhiteEnd, fallback.webgpuHdrWhiteEnd ?? fallback.whiteEnd, .01, WEBGPU_HDR_WHITE_END_MAX);
	return {
		webgpuHdrPeak: peak,
		webgpuHdrBrightness: brightness,
		webgpuHdrColorPreservation: colorPreservation,
		webgpuHdrWhiteCore: whiteCore,
		webgpuHdrWhiteStart: whiteStart,
		webgpuHdrWhiteEnd: Math.max(whiteStart + WEBGPU_HDR_WHITE_THRESHOLD_STEP, requestedWhiteEnd)
	};
}
const CONFIG_OVERRIDE_VALIDATORS = Object.freeze({
	scale: (value) => Number.isFinite(value) && value >= .01,
	opacity: (value) => Number.isFinite(value) && value >= 0 && value <= 1,
	themeColor: (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value),
	themeColorMode: isThemeColorMode,
	clickEnabled: (value) => typeof value === "boolean",
	trailEnabled: (value) => typeof value === "boolean",
	trailAlways: (value) => typeof value === "boolean",
	inputSource: isInputSource,
	inputSamplingRate: isInputSamplingRate,
	clickTimeScale: isTimeScale,
	trailTimeScale: isTimeScale,
	outputCompositing: isOutputCompositing,
	overlayAlphaPolicy: isOverlayAlphaPolicy,
	overlayColorCompensation: isOverlayColorCompensation,
	overlayAlphaLimit: isOverlayAlphaLimit,
	hostCompositing: isHostCompositing,
	hostCompositingSurface: isHostCompositingSurface,
	effectBackend: isEffectBackend,
	webgpuPreferHdr: (value) => typeof value === "boolean",
	webgpuHdrPeak: (value) => Number.isFinite(value) && value >= WEBGPU_HDR_PEAK_MIN && value <= WEBGPU_HDR_PEAK_MAX,
	webgpuHdrBrightness: (value) => Number.isFinite(value) && value >= 0 && value <= WEBGPU_HDR_BRIGHTNESS_MAX,
	webgpuHdrColorPreservation: (value) => Number.isFinite(value) && value >= 0 && value <= 1,
	webgpuHdrWhiteCore: (value) => Number.isFinite(value) && value >= 0 && value <= 1,
	webgpuHdrWhiteStart: (value) => Number.isFinite(value) && value >= WEBGPU_HDR_WHITE_THRESHOLD_MIN && value <= WEBGPU_HDR_WHITE_START_MAX,
	webgpuHdrWhiteEnd: (value) => Number.isFinite(value) && value >= WEBGPU_HDR_WHITE_THRESHOLD_STEP && value <= WEBGPU_HDR_WHITE_END_MAX,
	bloomBackend: isBloomBackend,
	isolatedCompositing: (value) => typeof value === "boolean",
	lightBackgroundContrastAlpha: (value) => Number.isFinite(value) && value >= 0 && value <= 1,
	maxDpr: (value) => Number.isFinite(value) && value >= 1,
	touchAction: (value) => typeof value === "string" && value.trim() !== ""
});
/**
* 公共配置入口必须在修改状态前完整拒绝无效输入，避免拼写错误或越界值
* 被静默吞掉后留下难以诊断的半生效配置。
*/
function assertConfigOverrides(overrides, { allowInstanceOptions = false, fallback = CONFIG } = {}) {
	if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) throw new TypeError("BAClickFX 配置必须是对象");
	for (const [key, value] of Object.entries(overrides)) {
		if (allowInstanceOptions && (key === "target" || key === "inputFilter")) {
			if (key === "inputFilter" && value !== void 0 && typeof value !== "function") throw new TypeError("BAClickFX 配置项 inputFilter 无效");
			continue;
		}
		const validator = CONFIG_OVERRIDE_VALIDATORS[key];
		if (!validator) throw new TypeError(`BAClickFX 未知配置项: ${key}`);
		if (value !== void 0 && !validator(value)) throw new TypeError(`BAClickFX 配置项 ${key} 无效`);
	}
	const whiteStart = overrides.webgpuHdrWhiteStart ?? fallback.webgpuHdrWhiteStart ?? fallback.whiteStart;
	if ((overrides.webgpuHdrWhiteEnd ?? fallback.webgpuHdrWhiteEnd ?? fallback.whiteEnd) < whiteStart + WEBGPU_HDR_WHITE_THRESHOLD_STEP) throw new TypeError("BAClickFX 配置项 webgpuHdrWhiteEnd 必须至少比 webgpuHdrWhiteStart 大 0.01");
}
/**
* 每个引擎实例持有独立的运行配置；Unity 参数本身保持只读。
* @param {object} [overrides]
* @returns {object}
*/
function createConfig(overrides = {}) {
	assertConfigOverrides(overrides);
	const supportedOverrides = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== void 0));
	const webgpuHdrPresentation = normalizeWebGPUHdrPresentation(supportedOverrides, CONFIG);
	return {
		...CONFIG,
		...supportedOverrides,
		themeColor: supportedOverrides.themeColor === void 0 ? CONFIG.themeColor : supportedOverrides.themeColor.toLowerCase(),
		...webgpuHdrPresentation
	};
}
//#endregion
//#region src/theme-color.js
const ACHROMATIC_EPSILON = 1e-5;
const BLACK_EPSILON = 1e-7;
const GAMUT_SEARCH_STEPS = 28;
const FULL_TURN = Math.PI * 2;
function clamp01$5(value) {
	return Math.max(0, Math.min(1, value));
}
function decodeSrgbChannel(channel) {
	if (channel <= .04045) return channel / 12.92;
	return ((channel + .055) / 1.055) ** 2.4;
}
function encodeSrgbChannel(channel) {
	if (channel <= .0031308) return channel * 12.92;
	return 1.055 * channel ** (1 / 2.4) - .055;
}
function parseThemeColor(themeColor) {
	if (typeof themeColor !== "string" || !/^#[0-9a-f]{6}$/i.test(themeColor)) throw new TypeError("themeColor 必须是 #rrggbb 格式的 sRGB 颜色");
	return [
		Number.parseInt(themeColor.slice(1, 3), 16),
		Number.parseInt(themeColor.slice(3, 5), 16),
		Number.parseInt(themeColor.slice(5, 7), 16)
	];
}
function validateSrgb255(rgb) {
	if (!Array.isArray(rgb) || rgb.length !== 3) throw new TypeError("rgb 必须是包含三个通道的数组");
	for (let index = 0; index < 3; index++) if (!Number.isFinite(rgb[index]) || rgb[index] < 0 || rgb[index] > 255) throw new RangeError("rgb 通道必须是 0 到 255 之间的有限数值");
}
function linearSrgbToOklab(rgb) {
	const [red, green, blue] = rgb;
	const l = Math.cbrt(.4122214708 * red + .5363325363 * green + .0514459929 * blue);
	const m = Math.cbrt(.2119034982 * red + .6806995451 * green + .1073969566 * blue);
	const s = Math.cbrt(.0883024619 * red + .2817188376 * green + .6299787005 * blue);
	return [
		.2104542553 * l + .793617785 * m - .0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
		.0259040371 * l + .7827717662 * m - .808675766 * s
	];
}
function oklabToLinearSrgb(oklab) {
	const [lightness, a, b] = oklab;
	const l = (lightness + .3963377774 * a + .2158037573 * b) ** 3;
	const m = (lightness - .1055613458 * a - .0638541728 * b) ** 3;
	const s = (lightness - .0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
		-.0041960863 * l - .7034186147 * m + 1.707614701 * s
	];
}
function srgb255ToOklch(rgb) {
	const [lightness, a, b] = linearSrgbToOklab(rgb.map((channel) => decodeSrgbChannel(channel / 255)));
	const chroma = Math.hypot(a, b);
	return [
		lightness,
		chroma,
		chroma <= ACHROMATIC_EPSILON ? 0 : Math.atan2(b, a)
	];
}
function normalizeHue(hue) {
	return hue - Math.floor(hue / FULL_TURN) * FULL_TURN;
}
function oklchToLinearSrgb(lightness, chroma, hue) {
	return oklabToLinearSrgb([
		lightness,
		chroma * Math.cos(hue),
		chroma * Math.sin(hue)
	]);
}
function isInSrgbGamut(linear) {
	return linear.every((channel) => Number.isFinite(channel) && channel >= -1e-7 && channel <= 1.0000001);
}
/**
* 保持感知明度与色相，只降低色度进入 sRGB；直接裁剪 RGB 会改变色相。
*/
function gamutMapOklch(lightness, chroma, hue) {
	let mappedChroma = Math.max(0, chroma);
	let linear = oklchToLinearSrgb(lightness, mappedChroma, hue);
	if (!isInSrgbGamut(linear)) {
		let lower = 0;
		let upper = mappedChroma;
		for (let index = 0; index < GAMUT_SEARCH_STEPS; index++) {
			const candidate = (lower + upper) / 2;
			if (isInSrgbGamut(oklchToLinearSrgb(lightness, candidate, hue))) lower = candidate;
			else upper = candidate;
		}
		mappedChroma = lower;
		linear = oklchToLinearSrgb(lightness, mappedChroma, hue);
	}
	return linear.map((channel) => clamp01$5(encodeSrgbChannel(clamp01$5(channel))) * 255);
}
const BASE_OKLCH = srgb255ToOklch(parseThemeColor(DEFAULT_THEME_COLOR));
/**
* 将取色器颜色预计算为可复用的相对 OKLCH 映射。
* 返回值可跨一帧内所有粒子颜色共享，避免重复解析主题颜色。
*/
function createRelativeOklchTheme(themeColor = DEFAULT_THEME_COLOR) {
	const targetRgb = parseThemeColor(themeColor);
	const canonicalColor = themeColor.toLowerCase();
	const [targetLightness, targetChroma, targetHue] = srgb255ToOklch(targetRgb);
	const targetIsAchromatic = targetChroma <= ACHROMATIC_EPSILON;
	return Object.freeze({
		color: canonicalColor,
		identity: canonicalColor === DEFAULT_THEME_COLOR,
		invisible: targetLightness <= BLACK_EPSILON,
		coverageScale: Math.max(...targetRgb) / 255,
		targetLightness,
		chromaScale: targetIsAchromatic ? 0 : targetChroma / BASE_OKLCH[1],
		hueShift: targetIsAchromatic ? 0 : normalizeHue(targetHue - BASE_OKLCH[2])
	});
}
function mapRelativeLightness(sourceLightness, targetLightness) {
	if (targetLightness <= BASE_OKLCH[0] || sourceLightness <= BASE_OKLCH[0]) return sourceLightness * targetLightness / BASE_OKLCH[0];
	return targetLightness + (sourceLightness - BASE_OKLCH[0]) * (1 - targetLightness) / (1 - BASE_OKLCH[0]);
}
/**
* 将一个 0..255 sRGB 颜色映射到主题色，返回同范围的有限浮点 sRGB。
* 默认主题走严格恒等路径，保证既有 Unity 默认画面不发生舍入漂移。
*/
function applyRelativeOklchTheme(rgb, theme) {
	validateSrgb255(rgb);
	if (!theme || typeof theme !== "object") throw new TypeError("theme 必须由 createRelativeOklchTheme 创建");
	if (theme.identity) return rgb;
	if (theme.invisible) return [
		0,
		0,
		0
	];
	const [sourceLightness, sourceChroma, sourceHue] = srgb255ToOklch(rgb);
	if (sourceLightness <= BLACK_EPSILON) return [
		0,
		0,
		0
	];
	return gamutMapOklch(mapRelativeLightness(sourceLightness, theme.targetLightness), sourceChroma <= ACHROMATIC_EPSILON ? 0 : sourceChroma * theme.chromaScale, normalizeHue(sourceHue + theme.hueShift));
}
//#endregion
//#region src/fx-param-patch.js
const FX_PARAM_DESCRIPTORS = new Map(FX_PARAM_SCHEMA.map((descriptor) => [descriptor.path, descriptor]));
function isConfigObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function cloneConfig(config) {
	return structuredClone(config);
}
function setConfigValue(config, path, value) {
	const keys = path.split(".");
	let target = config;
	for (let index = 0; index < keys.length - 1; index++) {
		const key = keys[index];
		if (!isConfigObject(target[key])) target[key] = {};
		target = target[key];
	}
	target[keys[keys.length - 1]] = value;
}
function createRejected(path, value, reason, details = {}) {
	return {
		path,
		value,
		reason,
		...details
	};
}
function validateMigrationSource(source, value) {
	if (!source) return null;
	if (source.type === "number") {
		if (typeof value !== "number") return "invalid-type";
		if (!Number.isFinite(value)) return "non-finite-number";
		const belowMinimum = Number.isFinite(source.min) && value < source.min;
		const aboveMaximum = Number.isFinite(source.max) && value > source.max;
		if (belowMinimum || aboveMaximum) return "out-of-range";
		return null;
	}
	return typeof value === "boolean" ? null : "invalid-type";
}
function resolveMigration(path, value, schemaVersion) {
	let currentVersion = schemaVersion;
	let resolvedPath = path;
	let resolvedValue = value;
	const normalized = [];
	while (currentVersion < 2) {
		const migration = FX_PARAM_MIGRATIONS.find((candidate) => candidate.fromVersion === currentVersion);
		if (!migration || migration.toVersion <= currentVersion) return {
			error: "missing-migration",
			path: resolvedPath,
			normalized
		};
		for (const change of migration.changes) {
			if (change.kind === "rename" && resolvedPath === change.from) {
				normalized.push({
					path: resolvedPath,
					from: resolvedPath,
					to: change.to,
					reason: "renamed"
				});
				resolvedPath = change.to;
			}
			if (change.kind === "replace" && resolvedPath === change.from) {
				const sourceError = validateMigrationSource(change.source, resolvedValue);
				if (sourceError) return {
					error: sourceError,
					path: resolvedPath,
					normalized
				};
				normalized.push({
					path: resolvedPath,
					from: resolvedPath,
					to: change.to,
					reason: "renamed"
				});
				resolvedPath = change.to;
				normalized.push({
					path: resolvedPath,
					from: resolvedValue,
					to: change.value,
					reason: "defaulted"
				});
				resolvedValue = change.value;
			}
		}
		currentVersion = migration.toVersion;
	}
	return {
		error: null,
		path: resolvedPath,
		value: resolvedValue,
		normalized
	};
}
function normalizeParamValue(descriptor, path, value) {
	if (descriptor.type === "boolean") {
		if (typeof value === "boolean") return {
			accepted: true,
			normalized: [],
			value
		};
		if (typeof value === "number" && Number.isFinite(value)) {
			const normalizedValue = !!value;
			return {
				accepted: true,
				normalized: [{
					path,
					from: value,
					to: normalizedValue,
					reason: "boolean-coercion"
				}],
				value: normalizedValue
			};
		}
		return {
			accepted: false,
			reason: typeof value === "number" ? "non-finite-number" : "invalid-type"
		};
	}
	if (descriptor.type !== "number" || typeof value !== "number") return {
		accepted: false,
		reason: "invalid-type"
	};
	if (!Number.isFinite(value)) return {
		accepted: false,
		reason: "non-finite-number"
	};
	const normalizedValue = Math.min(descriptor.max, Math.max(descriptor.min, value));
	if (normalizedValue === value) return {
		accepted: true,
		normalized: [],
		value
	};
	return {
		accepted: true,
		normalized: [{
			path,
			from: value,
			to: normalizedValue,
			reason: "clamped"
		}],
		value: normalizedValue
	};
}
function createResult(baseline, applied, normalized, rejected, committed, nextConfig) {
	return {
		applied,
		normalized,
		rejected,
		committed,
		schemaVersion: 2,
		nextConfig: committed ? nextConfig : cloneConfig(baseline)
	};
}
/**
* 根据公开 Schema 构造一次参数补丁的候选配置，不接触渲染实例或 DOM。
*
* patch 使用点号路径记录；baseline 表示当前配置，resetBaseline 由调用方按
* 当前渲染模式提供。strict 拒绝整批时，nextConfig 会回到 baseline 的副本。
*/
function applyFxParamPatch$1(patch, { baseline, reset = false, resetBaseline = baseline, strict = false, schemaVersion = 2 } = {}) {
	if (!isConfigObject(baseline)) throw new TypeError("baseline must be a configuration object");
	if (reset && !isConfigObject(resetBaseline)) throw new TypeError("resetBaseline must be a configuration object");
	const applied = [];
	const normalized = [];
	const rejected = [];
	if (!Number.isInteger(schemaVersion) || schemaVersion < 0 || schemaVersion > 2) {
		rejected.push(createRejected("$schemaVersion", schemaVersion, "unsupported-schema-version"));
		return createResult(baseline, applied, normalized, rejected, false, baseline);
	}
	if (!isConfigObject(patch)) {
		rejected.push(createRejected("$patch", patch, "invalid-patch"));
		return createResult(baseline, applied, normalized, rejected, false, baseline);
	}
	const entries = [];
	for (const [sourcePath, value] of Object.entries(patch)) {
		const migration = resolveMigration(sourcePath, value, schemaVersion);
		if (migration.error) {
			rejected.push(createRejected(sourcePath, value, migration.error));
			continue;
		}
		entries.push({
			sourcePath,
			sourceValue: value,
			path: migration.path,
			value: migration.value,
			migrations: migration.normalized
		});
	}
	const groupedEntries = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		const group = groupedEntries.get(entry.path) ?? [];
		group.push(entry);
		groupedEntries.set(entry.path, group);
	}
	const selectedEntries = [];
	for (const group of groupedEntries.values()) {
		const selected = group.find((entry) => entry.sourcePath === entry.path) ?? group[0];
		selectedEntries.push(selected);
		for (const entry of group) if (entry !== selected) rejected.push(createRejected(entry.sourcePath, entry.sourceValue, entry.migrations.length > 0 ? "migration-conflict" : "duplicate-path", { targetPath: entry.path }));
	}
	selectedEntries.sort((left, right) => {
		return (FX_PARAM_DESCRIPTORS.get(left.path)?.order ?? Infinity) - (FX_PARAM_DESCRIPTORS.get(right.path)?.order ?? Infinity) || left.sourcePath.localeCompare(right.sourcePath);
	});
	for (const entry of selectedEntries) {
		const descriptor = FX_PARAM_DESCRIPTORS.get(entry.path);
		if (!descriptor) {
			rejected.push(createRejected(entry.sourcePath, entry.sourceValue, "unknown-path"));
			continue;
		}
		const valueResult = normalizeParamValue(descriptor, entry.path, entry.value);
		if (!valueResult.accepted) {
			rejected.push(createRejected(entry.sourcePath, entry.sourceValue, valueResult.reason));
			continue;
		}
		applied.push({
			path: entry.path,
			value: valueResult.value
		});
		normalized.push(...entry.migrations, ...valueResult.normalized);
	}
	if (strict && rejected.length > 0) return createResult(baseline, [], normalized, rejected, false, baseline);
	const committed = reset || applied.length > 0;
	const nextConfig = cloneConfig(reset ? resetBaseline : baseline);
	for (const entry of applied) setConfigValue(nextConfig, entry.path, entry.value);
	return createResult(baseline, applied, normalized, rejected, committed, nextConfig);
}
//#endregion
//#region src/bloom-color-space.js
const HALF_FLOAT_MAX = 65504;
const DEFAULT_BLOOM_CLAMP = 65472;
/**
* 游戏把 Bloom 面板强度当作曝光刻度，并在绑定 Shader 前完成换算。
* Shader 里的乘法虽然是线性的，但接收到的并不是序列化原值。
*/
function resolveUnityBloomIntensity(value) {
	return Math.expm1((Number.isFinite(value) ? Math.max(0, value) : 0) / 10 * Math.LN2);
}
/**
* Unity 在把 Bloom 设置传给线性 HDR Shader 前调用 GammaToLinearSpace。
*/
function gammaToLinear(value) {
	const gamma = Math.max(0, value);
	if (gamma <= .04045) return gamma / 12.92;
	if (gamma < 1) return Math.pow((gamma + .055) / 1.055, 2.4);
	return Math.pow(gamma, 2.2);
}
/**
* 游戏 CPU 与 Threshold 一样先把序列化 Clamp 换算到线性空间。
* 默认值换算后会超过 half 范围，因此还要模拟 Shader 参数上限。
*/
function resolveUnityBloomClamp(value = DEFAULT_BLOOM_CLAMP) {
	return Math.min(HALF_FLOAT_MAX, gammaToLinear(Number.isFinite(value) ? value : DEFAULT_BLOOM_CLAMP));
}
//#endregion
//#region src/software-bloom.js
const RGB_CHANNELS = 3;
const RGBA_CHANNELS = 4;
const REGION_QUANTUM = 64;
const MAX_PYRAMID_LEVELS$1 = 16;
const DEFAULT_DIFFUSION = 7;
function clamp$4(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}
function clamp01$4(value) {
	return clamp$4(value, 0, 1);
}
function smoothstep$2(edge0, edge1, value) {
	const progress = clamp01$4((value - edge0) / (edge1 - edge0));
	return progress * progress * (3 - 2 * progress);
}
/**
* 将 Canvas 脏区的最终 Alpha 限制在独立容量内。getImageData 返回非预乘
* RGB，因此只降低 Alpha 就会让浏览器在写回时等比收敛预乘颜色。
*/
function limitCanvasAlpha(context, bounds, alphaLimit) {
	const canvas = context?.canvas;
	if (!canvas || !bounds || typeof context.getImageData !== "function" || typeof context.putImageData !== "function") return false;
	const minimumX = clamp$4(Math.floor(bounds.minimumX), 0, canvas.width);
	const minimumY = clamp$4(Math.floor(bounds.minimumY), 0, canvas.height);
	const maximumX = clamp$4(Math.ceil(bounds.maximumX + 1), minimumX, canvas.width);
	const maximumY = clamp$4(Math.ceil(bounds.maximumY + 1), minimumY, canvas.height);
	const width = maximumX - minimumX;
	const height = maximumY - minimumY;
	if (width <= 0 || height <= 0) return false;
	try {
		const image = context.getImageData(minimumX, minimumY, width, height);
		const maximumAlpha = Math.round(clamp01$4(alphaLimit ?? 1) * 255);
		let changed = false;
		for (let offset = 3; offset < image.data.length; offset += RGBA_CHANNELS) if (image.data[offset] > maximumAlpha) {
			image.data[offset] = maximumAlpha;
			changed = true;
		}
		if (changed) context.putImageData(image, minimumX, minimumY);
		return true;
	} catch {
		return false;
	}
}
function calculatePyramidSettings$1(displayWidth, displayHeight, resolutionScale, diffusion) {
	const safeScale = clamp$4(resolutionScale, .1, .75);
	const maxSize = Math.max(1, Math.floor(displayWidth * safeScale), Math.floor(displayHeight * safeScale));
	const logIterations = Math.log2(maxSize) + Math.min(Math.max(0, diffusion), 10) - 10;
	return {
		levelCount: clamp$4(Math.floor(logIterations), 1, MAX_PYRAMID_LEVELS$1),
		sampleScale: .5 + logIterations - Math.floor(logIterations)
	};
}
/**
* 将线性亮度转换为普通 Canvas/ImageData 使用的 sRGB 编码。
*/
function linearToSrgb(value) {
	const linear = clamp01$4(value);
	if (linear <= .0031308) return linear * 12.92;
	return 1.055 * Math.pow(linear, 1 / 2.4) - .055;
}
/**
* 计算带 Soft Knee 的高亮贡献，与 MXFinalBloom 的预过滤公式一致。
*/
function calculateBloomContribution(brightness, threshold, softKnee) {
	const safeThreshold = Math.max(0, threshold);
	const knee = safeThreshold * clamp01$4(softKnee) + 1e-5;
	let soft = brightness - safeThreshold + knee;
	soft = clamp$4(soft, 0, knee * 2);
	soft = soft * soft / (knee * 4);
	return Math.max(brightness - safeThreshold, soft, 0);
}
function writeThresholdedColor(red, green, blue, output, outputIndex, threshold, softKnee) {
	const brightness = Math.max(red, green, blue);
	if (brightness <= 0) {
		output[outputIndex] = 0;
		output[outputIndex + 1] = 0;
		output[outputIndex + 2] = 0;
		return 0;
	}
	const contribution = calculateBloomContribution(brightness, threshold, softKnee);
	const multiplier = contribution / Math.max(brightness, 1e-4);
	output[outputIndex] = Math.max(0, red * multiplier);
	output[outputIndex + 1] = Math.max(0, green * multiplier);
	output[outputIndex + 2] = Math.max(0, blue * multiplier);
	return contribution;
}
/**
* ImageData 被当作线性 HDR 的定点封装；这里只解码，不做显示色彩转换。
*/
function decodeEmissionMask(source, output, encodingRange, width = 0, height = 0, destinationWidth = width, destinationX = 0, destinationY = 0) {
	const channelScale = Math.max(1, encodingRange) / 65025;
	const hasDimensions = width > 0 && height > 0;
	const rowWidth = hasDimensions ? width : source.length / RGBA_CHANNELS;
	const rowCount = hasDimensions ? height : 1;
	const targetWidth = hasDimensions ? destinationWidth : rowWidth;
	let minimumX = targetWidth;
	let minimumY = hasDimensions ? destinationY + height : 1;
	let maximumX = -1;
	let maximumY = -1;
	let sourceIndex = 0;
	output.fill(0);
	for (let y = 0; y < rowCount; y++) {
		let outputIndex = hasDimensions ? ((destinationY + y) * targetWidth + destinationX) * RGB_CHANNELS : 0;
		for (let x = 0; x < rowWidth; x++) {
			const alpha = source[sourceIndex + 3];
			const hasEnergy = source[sourceIndex] !== 0 || source[sourceIndex + 1] !== 0 || source[sourceIndex + 2] !== 0;
			if (alpha !== 0 && hasEnergy) {
				output[outputIndex] = source[sourceIndex] * alpha * channelScale;
				output[outputIndex + 1] = source[sourceIndex + 1] * alpha * channelScale;
				output[outputIndex + 2] = source[sourceIndex + 2] * alpha * channelScale;
				if (hasDimensions) {
					const targetX = destinationX + x;
					const targetY = destinationY + y;
					minimumX = Math.min(minimumX, targetX);
					minimumY = Math.min(minimumY, targetY);
					maximumX = Math.max(maximumX, targetX);
					maximumY = Math.max(maximumY, targetY);
				}
			}
			sourceIndex += RGBA_CHANNELS;
			outputIndex += RGB_CHANNELS;
		}
	}
	if (maximumX < minimumX || maximumY < minimumY) return null;
	return {
		minimumX,
		minimumY,
		maximumX,
		maximumY
	};
}
/**
* 将独立 Coverage Canvas 的 Alpha 解码到单通道缓冲。
*
* HDR 发射颜色不能承担 Coverage，因为提高材质强度不应改变桌面遮挡率。
* 调用方应把几何纹理、生命周期和全局 opacity 全部写入源 Alpha。
*/
function decodeCoverageMask(source, output, width = 0, height = 0, destinationWidth = width, destinationX = 0, destinationY = 0) {
	const hasDimensions = width > 0 && height > 0;
	const rowWidth = hasDimensions ? width : source.length / RGBA_CHANNELS;
	const rowCount = hasDimensions ? height : 1;
	const targetWidth = hasDimensions ? destinationWidth : rowWidth;
	let minimumX = targetWidth;
	let minimumY = hasDimensions ? destinationY + height : 1;
	let maximumX = -1;
	let maximumY = -1;
	let sourceIndex = 0;
	output.fill(0);
	for (let y = 0; y < rowCount; y++) {
		let outputIndex = hasDimensions ? (destinationY + y) * targetWidth + destinationX : 0;
		for (let x = 0; x < rowWidth; x++) {
			const coverage = source[sourceIndex + 3] / 255;
			if (coverage > 0) {
				output[outputIndex] = coverage;
				if (hasDimensions) {
					const targetX = destinationX + x;
					const targetY = destinationY + y;
					minimumX = Math.min(minimumX, targetX);
					minimumY = Math.min(minimumY, targetY);
					maximumX = Math.max(maximumX, targetX);
					maximumY = Math.max(maximumY, targetY);
				}
			}
			sourceIndex += RGBA_CHANNELS;
			outputIndex++;
		}
	}
	if (maximumX < minimumX || maximumY < minimumY) return null;
	return {
		minimumX,
		minimumY,
		maximumX,
		maximumY
	};
}
function addBilinearRgb(source, width, height, x, y, weight, output, outputIndex) {
	const safeX = clamp$4(x, 0, width - 1);
	const safeY = clamp$4(y, 0, height - 1);
	const left = Math.floor(safeX);
	const top = Math.floor(safeY);
	const right = Math.min(left + 1, width - 1);
	const bottom = Math.min(top + 1, height - 1);
	const horizontal = safeX - left;
	const vertical = safeY - top;
	const topLeftWeight = (1 - horizontal) * (1 - vertical) * weight;
	const topRightWeight = horizontal * (1 - vertical) * weight;
	const bottomLeftWeight = (1 - horizontal) * vertical * weight;
	const bottomRightWeight = horizontal * vertical * weight;
	const topLeftIndex = (top * width + left) * RGB_CHANNELS;
	const topRightIndex = (top * width + right) * RGB_CHANNELS;
	const bottomLeftIndex = (bottom * width + left) * RGB_CHANNELS;
	const bottomRightIndex = (bottom * width + right) * RGB_CHANNELS;
	for (let channel = 0; channel < RGB_CHANNELS; channel++) output[outputIndex + channel] += source[topLeftIndex + channel] * topLeftWeight + source[topRightIndex + channel] * topRightWeight + source[bottomLeftIndex + channel] * bottomLeftWeight + source[bottomRightIndex + channel] * bottomRightWeight;
}
function sampleBilinearScalar(source, width, height, x, y) {
	const safeX = clamp$4(x, 0, width - 1);
	const safeY = clamp$4(y, 0, height - 1);
	const left = Math.floor(safeX);
	const top = Math.floor(safeY);
	const right = Math.min(left + 1, width - 1);
	const bottom = Math.min(top + 1, height - 1);
	const horizontal = safeX - left;
	const vertical = safeY - top;
	return source[top * width + left] * (1 - horizontal) * (1 - vertical) + source[top * width + right] * horizontal * (1 - vertical) + source[bottom * width + left] * (1 - horizontal) * vertical + source[bottom * width + right] * horizontal * vertical;
}
function filterBoxScalar(source, sourceWidth, sourceHeight, output, outputWidth, outputHeight, sampleOffset, sourceBounds = null, clampResult = false) {
	const scaleX = sourceWidth / outputWidth;
	const scaleY = sourceHeight / outputHeight;
	let startX = 0;
	let startY = 0;
	let endX = outputWidth;
	let endY = outputHeight;
	output.fill(0);
	if (sourceBounds) {
		startX = clamp$4(Math.floor((sourceBounds.minimumX - 2) / scaleX) - 1, 0, outputWidth);
		startY = clamp$4(Math.floor((sourceBounds.minimumY - 2) / scaleY) - 1, 0, outputHeight);
		endX = clamp$4(Math.ceil((sourceBounds.maximumX + 3) / scaleX) + 1, 0, outputWidth);
		endY = clamp$4(Math.ceil((sourceBounds.maximumY + 3) / scaleY) + 1, 0, outputHeight);
	}
	for (let y = startY; y < endY; y++) {
		const sourceY = (y + .5) * scaleY - .5;
		for (let x = startX; x < endX; x++) {
			const sourceX = (x + .5) * scaleX - .5;
			let coverage = 0;
			for (const offsetX of [-sampleOffset, sampleOffset]) for (const offsetY of [-sampleOffset, sampleOffset]) coverage += sampleBilinearScalar(source, sourceWidth, sourceHeight, sourceX + offsetX, sourceY + offsetY) * .25;
			output[y * outputWidth + x] = clampResult ? clamp01$4(coverage) : Math.max(0, coverage);
		}
	}
}
function filterBoxCoverage(source, sourceWidth, sourceHeight, output, outputWidth, outputHeight, sampleOffset, sourceBounds = null) {
	filterBoxScalar(source, sourceWidth, sourceHeight, output, outputWidth, outputHeight, sampleOffset, sourceBounds, true);
}
function upsampleTransportAndAdd(currentFine, fineWidth, fineHeight, accumulatedCoarse, coarseWidth, coarseHeight, output, sampleScale) {
	const scaleX = coarseWidth / fineWidth;
	const scaleY = coarseHeight / fineHeight;
	const offset = Math.max(0, sampleScale) * .5;
	output.fill(0);
	for (let y = 0; y < fineHeight; y++) {
		const coarseY = (y + .5) * scaleY - .5;
		for (let x = 0; x < fineWidth; x++) {
			const coarseX = (x + .5) * scaleX - .5;
			let coarseCoverage = 0;
			for (const offsetX of [-offset, offset]) for (const offsetY of [-offset, offset]) coarseCoverage += sampleBilinearScalar(accumulatedCoarse, coarseWidth, coarseHeight, coarseX + offsetX, coarseY + offsetY) * .25;
			const outputIndex = y * fineWidth + x;
			output[outputIndex] = Math.max(0, currentFine[outputIndex] + coarseCoverage);
		}
	}
}
/**
* 从全分辨率发射遮罩生成半分辨率 mip0，并执行 MXFinalBloom Box4 预过滤。
*/
function prefilterBloom(source, sourceWidth, sourceHeight, output, outputWidth, outputHeight, threshold, softKnee, clampMax = HALF_FLOAT_MAX, highQualityFiltering = true, sourceTexelAspect = sourceHeight / sourceWidth, sourceBounds = null, transportOutput = null) {
	const scaleX = sourceWidth / outputWidth;
	const scaleY = sourceHeight / outputHeight;
	let startX = 0;
	let startY = 0;
	let endX = outputWidth;
	let endY = outputHeight;
	let activeMinimumX = outputWidth;
	let activeMinimumY = outputHeight;
	let activeMaximumX = -1;
	let activeMaximumY = -1;
	output.fill(0);
	transportOutput?.fill(0);
	if (sourceBounds) {
		startX = clamp$4(Math.floor((sourceBounds.minimumX - 2) / scaleX) - 1, 0, outputWidth);
		startY = clamp$4(Math.floor((sourceBounds.minimumY - 2) / scaleY) - 1, 0, outputHeight);
		endX = clamp$4(Math.ceil((sourceBounds.maximumX + 3) / scaleX) + 1, 0, outputWidth);
		endY = clamp$4(Math.ceil((sourceBounds.maximumY + 3) / scaleY) + 1, 0, outputHeight);
	}
	for (let y = startY; y < endY; y++) {
		const sourceY = (y + .5) * scaleY - .5;
		for (let x = startX; x < endX; x++) {
			const sourceX = (x + .5) * scaleX - .5;
			const outputIndex = (y * outputWidth + x) * RGB_CHANNELS;
			output[outputIndex] = 0;
			output[outputIndex + 1] = 0;
			output[outputIndex + 2] = 0;
			for (const offsetX of [-1, 1]) for (const offsetY of [-1, 1]) addBilinearRgb(source, sourceWidth, sourceHeight, sourceX + offsetX, sourceY + offsetY, .25, output, outputIndex);
			const contribution = writeThresholdedColor(Math.min(clampMax, output[outputIndex]), Math.min(clampMax, output[outputIndex + 1]), Math.min(clampMax, output[outputIndex + 2]), output, outputIndex, threshold, softKnee);
			const transportIndex = y * outputWidth + x;
			if (transportOutput) transportOutput[transportIndex] = contribution;
			if (contribution > 0) {
				activeMinimumX = Math.min(activeMinimumX, x);
				activeMinimumY = Math.min(activeMinimumY, y);
				activeMaximumX = Math.max(activeMaximumX, x);
				activeMaximumY = Math.max(activeMaximumY, y);
			}
		}
	}
	if (activeMaximumX < activeMinimumX || activeMaximumY < activeMinimumY) return null;
	return {
		minimumX: activeMinimumX,
		minimumY: activeMinimumY,
		maximumX: activeMaximumX,
		maximumY: activeMaximumY
	};
}
/**
* 对上一层执行 MXFinalBloom 的 4-tap 盒式降采样。
*/
function downsampleBox(source, sourceWidth, sourceHeight, output, outputWidth, outputHeight) {
	const scaleX = sourceWidth / outputWidth;
	const scaleY = sourceHeight / outputHeight;
	let activeMinimumX = outputWidth;
	let activeMinimumY = outputHeight;
	let activeMaximumX = -1;
	let activeMaximumY = -1;
	output.fill(0);
	for (let y = 0; y < outputHeight; y++) {
		const sourceY = (y + .5) * scaleY - .5;
		for (let x = 0; x < outputWidth; x++) {
			const sourceX = (x + .5) * scaleX - .5;
			const outputIndex = (y * outputWidth + x) * RGB_CHANNELS;
			for (const offsetX of [-1, 1]) for (const offsetY of [-1, 1]) addBilinearRgb(source, sourceWidth, sourceHeight, sourceX + offsetX, sourceY + offsetY, .25, output, outputIndex);
			if (Math.max(output[outputIndex], output[outputIndex + 1], output[outputIndex + 2]) > 0) {
				activeMinimumX = Math.min(activeMinimumX, x);
				activeMinimumY = Math.min(activeMinimumY, y);
				activeMaximumX = Math.max(activeMaximumX, x);
				activeMaximumY = Math.max(activeMaximumY, y);
			}
		}
	}
	if (activeMaximumX < activeMinimumX || activeMaximumY < activeMinimumY) return null;
	return {
		minimumX: activeMinimumX,
		minimumY: activeMinimumY,
		maximumX: activeMaximumX,
		maximumY: activeMaximumY
	};
}
function downsampleGaussian(source, sourceWidth, sourceHeight, scratch, output, outputWidth, outputHeight, sourceBounds = null) {
	return downsampleBox(source, sourceWidth, sourceHeight, output, outputWidth, outputHeight);
}
/**
* MXFinalBloom 反向金字塔：累计粗级 4-tap 扩散后加上当前细级中心值。
*/
function upsampleBoxAndAdd(currentFine, fineWidth, fineHeight, accumulatedCoarse, coarseWidth, coarseHeight, output, sampleScale) {
	const scaleX = coarseWidth / fineWidth;
	const scaleY = coarseHeight / fineHeight;
	const offset = Math.max(0, sampleScale) * .5;
	output.fill(0);
	for (let y = 0; y < fineHeight; y++) {
		const coarseY = (y + .5) * scaleY - .5;
		for (let x = 0; x < fineWidth; x++) {
			const coarseX = (x + .5) * scaleX - .5;
			const outputIndex = (y * fineWidth + x) * RGB_CHANNELS;
			output[outputIndex] = currentFine[outputIndex];
			output[outputIndex + 1] = currentFine[outputIndex + 1];
			output[outputIndex + 2] = currentFine[outputIndex + 2];
			for (const offsetX of [-offset, offset]) for (const offsetY of [-offset, offset]) addBilinearRgb(accumulatedCoarse, coarseWidth, coarseHeight, coarseX + offsetX, coarseY + offsetY, .25, output, outputIndex);
		}
	}
	return {
		minimumX: 0,
		minimumY: 0,
		maximumX: fineWidth - 1,
		maximumY: fineHeight - 1
	};
}
function upsampleAndMixBloom(currentFine, fineWidth, fineHeight, accumulatedCoarse, coarseWidth, coarseHeight, output, scatter, highQualityFiltering = true, highBounds = null, lowBounds = null) {
	return upsampleBoxAndAdd(currentFine, fineWidth, fineHeight, accumulatedCoarse, coarseWidth, coarseHeight, output, scatter);
}
/**
* 将线性 HDR Bloom 转成可由透明 Canvas 保存的 sRGB 贡献。
*
* scene 保留原有的加色编码。browser-overlay 使用 Prefilter 贡献经过
* 同一 mip 链得到的传输上界，不从最终 RGB 反推 Alpha。
*/
function encodeAdditiveBloom(source, output, intensity, width = source.length / RGB_CHANNELS, bounds = null, edgeCorrection = null, options = null) {
	const safeIntensity = resolveUnityBloomIntensity(intensity);
	const transparentOverlay = options?.outputCompositing === "browser-overlay";
	const hostAdditive = transparentOverlay && isIndependentHostCompositing(options?.hostCompositing);
	const brightUnknownBackground = transparentOverlay && !hostAdditive && options?.overlayColorCompensation === "bright-core";
	const coverage = transparentOverlay ? options?.coverage : null;
	const sceneCoverage = transparentOverlay ? options?.sceneCoverage : null;
	const opacity = clamp01$4(options?.opacity ?? 1);
	const overlayAlphaLimit = clamp01$4(options?.overlayAlphaLimit ?? 1);
	const deferOverlayAlphaLimit = options?.deferOverlayAlphaLimit === true;
	const safeWidth = Math.max(1, Math.floor(width));
	const sourceHeight = Math.ceil(source.length / (safeWidth * RGB_CHANNELS));
	const startX = bounds ? clamp$4(Math.floor(bounds.minimumX), 0, safeWidth) : 0;
	const startY = bounds ? clamp$4(Math.floor(bounds.minimumY), 0, sourceHeight) : 0;
	const endX = bounds ? clamp$4(Math.ceil(bounds.maximumX + 1), startX, safeWidth) : safeWidth;
	const endY = bounds ? clamp$4(Math.ceil(bounds.maximumY + 1), startY, sourceHeight) : sourceHeight;
	const feather = Math.max(1, edgeCorrection?.feather ?? 1);
	const leftFloor = edgeCorrection?.left;
	const rightFloor = edgeCorrection?.right;
	const topFloor = edgeCorrection?.top;
	const bottomFloor = edgeCorrection?.bottom;
	for (let y = startY; y < endY; y++) {
		let sourceIndex = (y * safeWidth + startX) * RGB_CHANNELS;
		let outputIndex = (y * safeWidth + startX) * RGBA_CHANNELS;
		const topWeight = topFloor ? smoothBloomEdgeWeight(y - edgeCorrection.minimumY, feather) : 0;
		const bottomWeight = bottomFloor ? smoothBloomEdgeWeight(edgeCorrection.maximumY - y, feather) : 0;
		const verticalRedFloor = Math.max((topFloor?.[0] ?? 0) * topWeight, (bottomFloor?.[0] ?? 0) * bottomWeight);
		const verticalGreenFloor = Math.max((topFloor?.[1] ?? 0) * topWeight, (bottomFloor?.[1] ?? 0) * bottomWeight);
		const verticalBlueFloor = Math.max((topFloor?.[2] ?? 0) * topWeight, (bottomFloor?.[2] ?? 0) * bottomWeight);
		for (let x = startX; x < endX; x++) {
			const leftWeight = leftFloor ? smoothBloomEdgeWeight(x - edgeCorrection.minimumX, feather) : 0;
			const rightWeight = rightFloor ? smoothBloomEdgeWeight(edgeCorrection.maximumX - x, feather) : 0;
			const redFloor = Math.max(verticalRedFloor, (leftFloor?.[0] ?? 0) * leftWeight, (rightFloor?.[0] ?? 0) * rightWeight);
			const greenFloor = Math.max(verticalGreenFloor, (leftFloor?.[1] ?? 0) * leftWeight, (rightFloor?.[1] ?? 0) * rightWeight);
			const blueFloor = Math.max(verticalBlueFloor, (leftFloor?.[2] ?? 0) * leftWeight, (rightFloor?.[2] ?? 0) * rightWeight);
			const red = linearToSrgb(Math.max(0, source[sourceIndex] - redFloor) * safeIntensity);
			const green = linearToSrgb(Math.max(0, source[sourceIndex + 1] - greenFloor) * safeIntensity);
			const blue = linearToSrgb(Math.max(0, source[sourceIndex + 2] - blueFloor) * safeIntensity);
			const maximumSrgb = Math.max(red, green, blue);
			const pixelIndex = y * safeWidth + x;
			let alpha = maximumSrgb;
			let transportAlpha = maximumSrgb;
			if (transparentOverlay) {
				transportAlpha = linearToSrgb(Math.max(0, coverage?.[pixelIndex] ?? 0) * safeIntensity);
				if (hostAdditive) alpha = Math.max(maximumSrgb, Math.min(1, transportAlpha));
				else if (deferOverlayAlphaLimit) alpha = transportAlpha;
				else {
					const sceneAlpha = clamp01$4(sceneCoverage?.[pixelIndex] ?? 0);
					const remainingCapacity = Math.max(0, overlayAlphaLimit - sceneAlpha);
					alpha = Math.min(transportAlpha, remainingCapacity);
				}
			}
			if (alpha <= 1e-5 || !transparentOverlay && maximumSrgb <= 1e-5) {
				output[outputIndex] = 0;
				output[outputIndex + 1] = 0;
				output[outputIndex + 2] = 0;
				output[outputIndex + 3] = 0;
			} else {
				const normalization = transparentOverlay && !hostAdditive ? deferOverlayAlphaLimit ? alpha : Math.max(alpha, transportAlpha) : alpha;
				let outputRed = clamp01$4(red / normalization);
				let outputGreen = clamp01$4(green / normalization);
				let outputBlue = clamp01$4(blue / normalization);
				if (brightUnknownBackground) {
					const safeOpacity = Math.max(opacity, 1e-6);
					const normalizedTransport = linearToSrgb(Math.max(0, coverage?.[pixelIndex] ?? 0) * safeIntensity / safeOpacity);
					const ratioGate = smoothstep$2(.25, .75, linearToSrgb(Math.max(source[sourceIndex], source[sourceIndex + 1], source[sourceIndex + 2]) * safeIntensity / safeOpacity) / Math.max(normalizedTransport, 1e-6));
					const energyGate = smoothstep$2(.03125, .25, normalizedTransport);
					const maximum = Math.max(outputRed, outputGreen, outputBlue);
					const amount = BRIGHT_CORE_CHANNEL_MIX * ratioGate * energyGate;
					outputRed += (maximum - outputRed) * amount;
					outputGreen += (maximum - outputGreen) * amount;
					outputBlue += (maximum - outputBlue) * amount;
				}
				output[outputIndex] = Math.round(outputRed * 255);
				output[outputIndex + 1] = Math.round(outputGreen * 255);
				output[outputIndex + 2] = Math.round(outputBlue * 255);
				output[outputIndex + 3] = Math.round(alpha * 255);
			}
			sourceIndex += RGB_CHANNELS;
			outputIndex += RGBA_CHANNELS;
		}
	}
}
function filterBloomForComposite(source, width, height, output, sampleScale) {
	const offset = Math.max(0, sampleScale) * .5;
	output.fill(0);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const outputIndex = (y * width + x) * RGB_CHANNELS;
		for (const offsetX of [-offset, offset]) for (const offsetY of [-offset, offset]) addBilinearRgb(source, width, height, x + offsetX, y + offsetY, .25, output, outputIndex);
	}
}
function smoothBloomEdgeWeight(distance, feather) {
	const normalized = clamp01$4(1 - Math.max(0, distance) / feather);
	return normalized * normalized * (3 - 2 * normalized);
}
/**
* 最深层 mip 会在局部缓冲中形成接近常量的低频底色。全屏管线中该能量
* 会继续向画面外扩散；局部裁剪则会把它截成矩形。这里只记录每条人工
* 边界的基线，编码时再向内部平滑减弱，避免全局扣除压暗真实外晕。
*/
function calculateBloomEdgeCorrection(source, width, height, bounds, edges) {
	if (!bounds || !edges.left && !edges.right && !edges.top && !edges.bottom) return null;
	const minimumX = clamp$4(Math.floor(bounds.minimumX), 0, width - 1);
	const minimumY = clamp$4(Math.floor(bounds.minimumY), 0, height - 1);
	const maximumX = clamp$4(Math.ceil(bounds.maximumX), minimumX, width - 1);
	const maximumY = clamp$4(Math.ceil(bounds.maximumY), minimumY, height - 1);
	const sampleEdge = (visit) => {
		const floor = [
			0,
			0,
			0
		];
		visit((x, y) => {
			const index = (y * width + x) * RGB_CHANNELS;
			for (let channel = 0; channel < RGB_CHANNELS; channel++) floor[channel] = Math.max(floor[channel], source[index + channel]);
		});
		return floor;
	};
	const correction = {
		minimumX,
		minimumY,
		maximumX,
		maximumY,
		feather: clamp$4(Math.round(Math.min(maximumX - minimumX + 1, maximumY - minimumY + 1) * .125), 2, 16),
		left: null,
		right: null,
		top: null,
		bottom: null
	};
	if (edges.top) correction.top = sampleEdge((sample) => {
		for (let x = minimumX; x <= maximumX; x++) sample(x, minimumY);
	});
	if (edges.bottom) correction.bottom = sampleEdge((sample) => {
		for (let x = minimumX; x <= maximumX; x++) sample(x, maximumY);
	});
	if (edges.left) correction.left = sampleEdge((sample) => {
		for (let y = minimumY; y <= maximumY; y++) sample(minimumX, y);
	});
	if (edges.right) correction.right = sampleEdge((sample) => {
		for (let y = minimumY; y <= maximumY; y++) sample(maximumX, y);
	});
	return correction;
}
/**
* 一个实例只持有一套金字塔缓冲；模块加载时不访问 DOM，兼容 SSR。
*/
var SoftwareBloomRenderer = class {
	constructor(createCanvas) {
		this.createCanvas = createCanvas;
		this.sourceCanvas = createCanvas();
		this.outputCanvas = createCanvas();
		this.sourceContext = this.sourceCanvas?.getContext?.("2d", {
			alpha: true,
			willReadFrequently: true
		});
		this.outputContext = this.outputCanvas?.getContext?.("2d", { alpha: true });
		this.sourceWidth = 0;
		this.sourceHeight = 0;
		this.width = 0;
		this.height = 0;
		this.originX = 0;
		this.originY = 0;
		this.regionWidth = 0;
		this.regionHeight = 0;
		this.resolutionScale = 0;
		this.diffusion = 0;
		this.sampleScale = 1;
		this.displayWidth = 0;
		this.displayHeight = 0;
		this.displayCssWidth = 0;
		this.displayCssHeight = 0;
		this.sourceLinear = /* @__PURE__ */ new Float32Array(0);
		this.coverageCanvas = null;
		this.coverageContext = null;
		this.sourceCoverage = /* @__PURE__ */ new Float32Array(0);
		this.sceneCoverageMip0 = /* @__PURE__ */ new Float32Array(0);
		this.coverageLevels = [];
		this.coverageLevelStorage = [];
		this.coverageFrameReady = false;
		this.levels = [];
		this.levelStorage = [];
		this.outputImageData = null;
		this.outputBounds = null;
		this.sourceReadBounds = null;
		this.floatBufferAllocationCount = 0;
		this.available = Boolean(this.sourceContext && this.outputContext && typeof this.sourceContext.getImageData === "function" && typeof this.outputContext.createImageData === "function" && typeof this.outputContext.putImageData === "function");
	}
	_resizeFloatBuffer(buffer, length) {
		const capacity = buffer.buffer.byteLength / Float32Array.BYTES_PER_ELEMENT;
		if (capacity < length) {
			const nextCapacity = Math.max(length, Math.ceil(capacity * 1.5));
			this.floatBufferAllocationCount++;
			return new Float32Array(nextCapacity).subarray(0, length);
		}
		if (buffer.length === length) return buffer;
		return new Float32Array(buffer.buffer, 0, length);
	}
	_ensureCanvasCapacity(canvas, width, height) {
		if (canvas.width >= width && canvas.height >= height) return;
		canvas.width = Math.max(canvas.width, width);
		canvas.height = Math.max(canvas.height, height);
	}
	_ensureCoverageSurface() {
		if (this.coverageContext) return true;
		const canvas = this.createCanvas?.();
		const context = canvas?.getContext?.("2d", {
			alpha: true,
			willReadFrequently: true
		});
		if (!canvas || !context || typeof context.getImageData !== "function") return false;
		this.coverageCanvas = canvas;
		this.coverageContext = context;
		return true;
	}
	_ensureCoverageBuffers() {
		this.sourceCoverage = this._resizeFloatBuffer(this.sourceCoverage, this.sourceWidth * this.sourceHeight);
		this.sceneCoverageMip0 = this._resizeFloatBuffer(this.sceneCoverageMip0, this.width * this.height);
		this.coverageLevels = this.levels.map((level, index) => {
			const length = level.width * level.height;
			const storage = this.coverageLevelStorage[index] ?? {
				width: 0,
				height: 0,
				down: /* @__PURE__ */ new Float32Array(0),
				up: /* @__PURE__ */ new Float32Array(0),
				scratch: /* @__PURE__ */ new Float32Array(0)
			};
			storage.width = level.width;
			storage.height = level.height;
			storage.down = this._resizeFloatBuffer(storage.down, length);
			storage.up = this._resizeFloatBuffer(storage.up, length);
			storage.scratch = this._resizeFloatBuffer(storage.scratch, length);
			this.coverageLevelStorage[index] = storage;
			return storage;
		});
		return this.coverageLevels.length === this.levels.length;
	}
	_resize(regionWidth, regionHeight, resolutionScale, displayWidth, displayHeight, diffusion, samplingScale) {
		const safeScale = clamp$4(resolutionScale, .1, .75);
		const sourceWidth = Math.max(1, Math.round(regionWidth * samplingScale));
		const sourceHeight = Math.max(1, Math.round(regionHeight * samplingScale));
		const width = Math.max(1, Math.floor(sourceWidth * safeScale));
		const height = Math.max(1, Math.floor(sourceHeight * safeScale));
		const pyramid = calculatePyramidSettings$1(displayWidth, displayHeight, safeScale, diffusion);
		const desiredLevelCount = pyramid.levelCount;
		const dimensions = [];
		let levelWidth = width;
		let levelHeight = height;
		for (let level = 0; level < desiredLevelCount; level++) {
			dimensions.push([levelWidth, levelHeight]);
			if (levelWidth === 1 && levelHeight === 1) break;
			levelWidth = Math.max(1, levelWidth >> 1);
			levelHeight = Math.max(1, levelHeight >> 1);
		}
		const sameDimensions = sourceWidth === this.sourceWidth && sourceHeight === this.sourceHeight && width === this.width && height === this.height && dimensions.length === this.levels.length && dimensions.every(([nextWidth, nextHeight], index) => this.levels[index]?.width === nextWidth && this.levels[index]?.height === nextHeight);
		this.regionWidth = regionWidth;
		this.regionHeight = regionHeight;
		this.resolutionScale = safeScale;
		this.displayWidth = displayWidth;
		this.displayHeight = displayHeight;
		this.diffusion = diffusion;
		this.sampleScale = pyramid.sampleScale;
		if (sameDimensions) return true;
		this.sourceWidth = sourceWidth;
		this.sourceHeight = sourceHeight;
		this.width = width;
		this.height = height;
		this._ensureCanvasCapacity(this.sourceCanvas, sourceWidth, sourceHeight);
		this._ensureCanvasCapacity(this.outputCanvas, width, height);
		this.sourceLinear = this._resizeFloatBuffer(this.sourceLinear, sourceWidth * sourceHeight * RGB_CHANNELS);
		this.levels = dimensions.map(([nextWidth, nextHeight], index) => {
			const length = nextWidth * nextHeight * RGB_CHANNELS;
			const storage = this.levelStorage[index] ?? {
				width: 0,
				height: 0,
				down: /* @__PURE__ */ new Float32Array(0),
				up: /* @__PURE__ */ new Float32Array(0),
				scratch: /* @__PURE__ */ new Float32Array(0)
			};
			storage.width = nextWidth;
			storage.height = nextHeight;
			storage.down = this._resizeFloatBuffer(storage.down, length);
			storage.up = this._resizeFloatBuffer(storage.up, length);
			storage.scratch = this._resizeFloatBuffer(storage.scratch, length);
			this.levelStorage[index] = storage;
			return storage;
		});
		try {
			this.outputImageData = this.outputContext.createImageData(width, height);
			this.outputContext.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);
			this.outputBounds = null;
		} catch {
			this.available = false;
			this.outputImageData = null;
			return false;
		}
		return true;
	}
	beginFrame(displayWidth, displayHeight, resolutionScale, bounds, diffusion = DEFAULT_DIFFUSION, samplingScale = 1, emissionBounds = bounds) {
		this.coverageFrameReady = false;
		if (!this.available || !bounds) return null;
		const safeSamplingScale = clamp$4(samplingScale, 1, 4);
		this.displayCssWidth = displayWidth;
		this.displayCssHeight = displayHeight;
		const pixelDisplayWidth = Math.max(1, Math.round(displayWidth * safeSamplingScale));
		const pixelDisplayHeight = Math.max(1, Math.round(displayHeight * safeSamplingScale));
		const levelCount = calculatePyramidSettings$1(pixelDisplayWidth, pixelDisplayHeight, resolutionScale, diffusion).levelCount;
		const regionQuantum = Math.max(REGION_QUANTUM, 2 ** Math.max(0, levelCount - 1));
		const leftPixels = clamp$4(Math.floor(bounds.x * safeSamplingScale / regionQuantum) * regionQuantum, 0, pixelDisplayWidth);
		const topPixels = clamp$4(Math.floor(bounds.y * safeSamplingScale / regionQuantum) * regionQuantum, 0, pixelDisplayHeight);
		const rightPixels = clamp$4(Math.ceil((bounds.x + bounds.width) * safeSamplingScale / regionQuantum) * regionQuantum, 0, pixelDisplayWidth);
		const bottomPixels = clamp$4(Math.ceil((bounds.y + bounds.height) * safeSamplingScale / regionQuantum) * regionQuantum, 0, pixelDisplayHeight);
		const left = leftPixels / safeSamplingScale;
		const top = topPixels / safeSamplingScale;
		const right = rightPixels / safeSamplingScale;
		const bottom = bottomPixels / safeSamplingScale;
		const regionWidth = right - left;
		const regionHeight = bottom - top;
		if (regionWidth <= 0 || regionHeight <= 0 || !this._resize(regionWidth, regionHeight, resolutionScale, pixelDisplayWidth, pixelDisplayHeight, diffusion, safeSamplingScale)) return null;
		this.originX = left;
		this.originY = top;
		const scaleX = this.sourceWidth / regionWidth;
		const scaleY = this.sourceHeight / regionHeight;
		const safeEmissionBounds = emissionBounds ?? bounds;
		const readPadding = 2;
		const readLeft = clamp$4(Math.floor((safeEmissionBounds.x - left) * scaleX) - readPadding, 0, this.sourceWidth);
		const readTop = clamp$4(Math.floor((safeEmissionBounds.y - top) * scaleY) - readPadding, 0, this.sourceHeight);
		const readRight = clamp$4(Math.ceil((safeEmissionBounds.x + safeEmissionBounds.width - left) * scaleX) + readPadding, readLeft, this.sourceWidth);
		const readBottom = clamp$4(Math.ceil((safeEmissionBounds.y + safeEmissionBounds.height - top) * scaleY) + readPadding, readTop, this.sourceHeight);
		this.sourceReadBounds = {
			x: readLeft,
			y: readTop,
			width: readRight - readLeft,
			height: readBottom - readTop
		};
		this.sourceContext.setTransform(1, 0, 0, 1, 0, 0);
		this.sourceContext.clearRect(0, 0, this.sourceWidth, this.sourceHeight);
		this.sourceContext.setTransform(scaleX, 0, 0, scaleY, -left * scaleX, -top * scaleY);
		this.sourceContext.globalCompositeOperation = "lighter";
		return this.sourceContext;
	}
	/**
	* 为 browser-overlay 准备独立 Coverage 源。
	*
	* 调用方应在 beginFrame() 之后调用，并使用白色几何把纹理 Coverage、
	* 生命周期 Alpha 与全局 opacity 写入返回 Context 的 Alpha。
	*/
	beginCoverageFrame(outputCompositing = "scene") {
		this.coverageFrameReady = false;
		if (outputCompositing !== "browser-overlay") return null;
		if (!this.available || this.sourceWidth <= 0 || this.sourceHeight <= 0 || this.regionWidth <= 0 || this.regionHeight <= 0 || !this._ensureCoverageSurface()) return null;
		this._ensureCanvasCapacity(this.coverageCanvas, this.sourceWidth, this.sourceHeight);
		const scaleX = this.sourceWidth / this.regionWidth;
		const scaleY = this.sourceHeight / this.regionHeight;
		this.coverageContext.setTransform(1, 0, 0, 1, 0, 0);
		this.coverageContext.clearRect(0, 0, this.sourceWidth, this.sourceHeight);
		this.coverageContext.setTransform(scaleX, 0, 0, scaleY, -this.originX * scaleX, -this.originY * scaleY);
		this.coverageContext.globalCompositeOperation = "source-over";
		this.coverageFrameReady = true;
		return this.coverageContext;
	}
	composite(targetContext, settings) {
		if (!this.available || !this.outputImageData || this.levels.length === 0) return false;
		const transparentOverlay = settings.outputCompositing === "browser-overlay";
		if (transparentOverlay && (!this.coverageFrameReady || !this._ensureCoverageBuffers())) return false;
		const readBounds = this.sourceReadBounds ?? {
			x: 0,
			y: 0,
			width: this.sourceWidth,
			height: this.sourceHeight
		};
		let emissionBounds = null;
		let coverageBounds = null;
		if (readBounds.width > 0 && readBounds.height > 0) {
			let sourceImageData;
			let coverageImageData;
			try {
				sourceImageData = this.sourceContext.getImageData(readBounds.x, readBounds.y, readBounds.width, readBounds.height);
				if (transparentOverlay) coverageImageData = this.coverageContext.getImageData(readBounds.x, readBounds.y, readBounds.width, readBounds.height);
			} catch {
				this.available = false;
				return false;
			}
			emissionBounds = decodeEmissionMask(sourceImageData.data, this.sourceLinear, settings.encodingRange, readBounds.width, readBounds.height, this.sourceWidth, readBounds.x, readBounds.y);
			if (transparentOverlay) coverageBounds = decodeCoverageMask(coverageImageData.data, this.sourceCoverage, readBounds.width, readBounds.height, this.sourceWidth, readBounds.x, readBounds.y);
		} else {
			this.sourceLinear.fill(0);
			if (transparentOverlay) this.sourceCoverage.fill(0);
		}
		this.coverageFrameReady = false;
		const firstLevel = this.levels[0];
		const firstCoverageLevel = transparentOverlay ? this.coverageLevels[0] : null;
		const activeBounds = [];
		activeBounds[0] = prefilterBloom(this.sourceLinear, this.sourceWidth, this.sourceHeight, firstLevel.down, firstLevel.width, firstLevel.height, gammaToLinear(settings.threshold), settings.softKnee, resolveUnityBloomClamp(settings.clamp), true, 1, emissionBounds, firstCoverageLevel?.down);
		if (transparentOverlay) filterBoxCoverage(this.sourceCoverage, this.sourceWidth, this.sourceHeight, this.sceneCoverageMip0, firstCoverageLevel.width, firstCoverageLevel.height, 1, coverageBounds);
		if (!activeBounds[0]) {
			this._clearOutputBounds();
			return this._drawOutput(targetContext);
		}
		for (let level = 1; level < this.levels.length; level++) {
			const previous = this.levels[level - 1];
			const current = this.levels[level];
			activeBounds[level] = downsampleGaussian(previous.down, previous.width, previous.height, current.scratch, current.down, current.width, current.height, activeBounds[level - 1]);
			if (transparentOverlay) {
				const previousCoverage = this.coverageLevels[level - 1];
				const currentCoverage = this.coverageLevels[level];
				filterBoxScalar(previousCoverage.down, previousCoverage.width, previousCoverage.height, currentCoverage.down, currentCoverage.width, currentCoverage.height, 1);
			}
		}
		let bloom = this.levels.at(-1).down;
		let bloomBounds = activeBounds.at(-1);
		let bloomCoverage = transparentOverlay ? this.coverageLevels.at(-1).down : null;
		for (let level = this.levels.length - 2; level >= 0; level--) {
			const fineLevel = this.levels[level];
			const accumulatedCoarseLevel = this.levels[level + 1];
			bloomBounds = upsampleAndMixBloom(fineLevel.down, fineLevel.width, fineLevel.height, bloom, accumulatedCoarseLevel.width, accumulatedCoarseLevel.height, fineLevel.up, this.sampleScale, true, activeBounds[level], bloomBounds);
			bloom = fineLevel.up;
			if (transparentOverlay) {
				const fineCoverageLevel = this.coverageLevels[level];
				const accumulatedCoarseCoverageLevel = this.coverageLevels[level + 1];
				upsampleTransportAndAdd(fineCoverageLevel.down, fineCoverageLevel.width, fineCoverageLevel.height, bloomCoverage, accumulatedCoarseCoverageLevel.width, accumulatedCoarseCoverageLevel.height, fineCoverageLevel.up, this.sampleScale);
				bloomCoverage = fineCoverageLevel.up;
			}
		}
		this._clearOutputBounds();
		const compositeBloom = this.levels[0].scratch;
		filterBloomForComposite(bloom, this.width, this.height, compositeBloom, this.sampleScale);
		let compositeCoverage = null;
		if (transparentOverlay) {
			compositeCoverage = this.coverageLevels[0].scratch;
			filterBoxScalar(bloomCoverage, this.width, this.height, compositeCoverage, this.width, this.height, Math.max(0, this.sampleScale) * .5);
		}
		const edgeCorrection = calculateBloomEdgeCorrection(compositeBloom, this.width, this.height, bloomBounds, {
			left: bloomBounds.minimumX > 0 || this.originX > 0,
			top: bloomBounds.minimumY > 0 || this.originY > 0,
			right: bloomBounds.maximumX < this.width - 1 || this.originX + this.regionWidth < this.displayCssWidth,
			bottom: bloomBounds.maximumY < this.height - 1 || this.originY + this.regionHeight < this.displayCssHeight
		});
		encodeAdditiveBloom(compositeBloom, this.outputImageData.data, settings.intensity, this.width, bloomBounds, edgeCorrection, {
			outputCompositing: settings.outputCompositing,
			overlayColorCompensation: settings.overlayColorCompensation,
			hostCompositing: settings.hostCompositing,
			overlayAlphaLimit: settings.overlayAlphaLimit,
			deferOverlayAlphaLimit: true,
			coverage: compositeCoverage,
			opacity: settings.opacity,
			sceneCoverage: transparentOverlay ? this.sceneCoverageMip0 : null
		});
		this.outputBounds = bloomBounds;
		this.outputContext.putImageData(this.outputImageData, 0, 0, bloomBounds.minimumX, bloomBounds.minimumY, bloomBounds.maximumX - bloomBounds.minimumX + 1, bloomBounds.maximumY - bloomBounds.minimumY + 1);
		if (!this._drawOutput(targetContext)) return false;
		if (transparentOverlay && !isIndependentHostCompositing(settings.hostCompositing) && settings.enforceOverlayAlphaLimit === true) this._limitTransparentOverlayAlpha(targetContext, settings.overlayAlphaLimit);
		return true;
	}
	_drawOutput(targetContext) {
		targetContext.imageSmoothingEnabled = true;
		targetContext.imageSmoothingQuality = "high";
		targetContext.drawImage(this.outputCanvas, 0, 0, this.width, this.height, this.originX, this.originY, this.regionWidth, this.regionHeight);
		return true;
	}
	drawCurrentOutput(targetContext) {
		if (!targetContext || !this.outputCanvas) return false;
		return this._drawOutput(targetContext);
	}
	_limitTransparentOverlayAlpha(targetContext, overlayAlphaLimit) {
		if (!this.outputBounds || typeof targetContext?.getImageData !== "function" || typeof targetContext?.putImageData !== "function") return;
		const targetCanvas = targetContext.canvas;
		const sourceScaleX = this.sourceWidth / Math.max(1, this.regionWidth);
		const sourceScaleY = this.sourceHeight / Math.max(1, this.regionHeight);
		const outputScaleX = this.sourceWidth / Math.max(1, this.width);
		const outputScaleY = this.sourceHeight / Math.max(1, this.height);
		if (!Number.isFinite(targetCanvas?.width) || !Number.isFinite(targetCanvas?.height) || !Number.isFinite(sourceScaleX) || !Number.isFinite(sourceScaleY) || !Number.isFinite(outputScaleX) || !Number.isFinite(outputScaleY)) return;
		const bounds = this.outputBounds;
		const minimumX = clamp$4(Math.floor(this.originX * sourceScaleX + (bounds.minimumX - 1) * outputScaleX), 0, targetCanvas.width);
		const minimumY = clamp$4(Math.floor(this.originY * sourceScaleY + (bounds.minimumY - 1) * outputScaleY), 0, targetCanvas.height);
		const maximumX = clamp$4(Math.ceil(this.originX * sourceScaleX + (bounds.maximumX + 2) * outputScaleX), minimumX, targetCanvas.width);
		const maximumY = clamp$4(Math.ceil(this.originY * sourceScaleY + (bounds.maximumY + 2) * outputScaleY), minimumY, targetCanvas.height);
		const width = maximumX - minimumX;
		const height = maximumY - minimumY;
		if (width <= 0 || height <= 0) return;
		limitCanvasAlpha(targetContext, {
			minimumX,
			minimumY,
			maximumX: maximumX - 1,
			maximumY: maximumY - 1
		}, overlayAlphaLimit);
	}
	_clearOutputBounds() {
		if (!this.outputBounds) return;
		const bounds = this.outputBounds;
		this.outputContext.clearRect(bounds.minimumX, bounds.minimumY, bounds.maximumX - bounds.minimumX + 1, bounds.maximumY - bounds.minimumY + 1);
		this.outputBounds = null;
	}
	destroy() {
		this.sourceCanvas.width = 0;
		this.sourceCanvas.height = 0;
		this.outputCanvas.width = 0;
		this.outputCanvas.height = 0;
		if (this.coverageCanvas) {
			this.coverageCanvas.width = 0;
			this.coverageCanvas.height = 0;
		}
		this.available = false;
		this.sourceLinear = /* @__PURE__ */ new Float32Array(0);
		this.sourceCoverage = /* @__PURE__ */ new Float32Array(0);
		this.sceneCoverageMip0 = /* @__PURE__ */ new Float32Array(0);
		this.coverageCanvas = null;
		this.coverageContext = null;
		this.coverageLevels = [];
		this.coverageLevelStorage = [];
		this.coverageFrameReady = false;
		this.levels = [];
		this.levelStorage = [];
		this.outputImageData = null;
		this.outputBounds = null;
		this.sourceReadBounds = null;
	}
};
const TRIANGLE_POINTS = Object.freeze([
	Object.freeze([-.9609375, -.7265625]),
	Object.freeze([.9609375, -.7265625]),
	Object.freeze([0, .9140625])
]);
const TRIANGLE_TEXTURE_INSET_RATE = 1.16465;
function clamp01$3(value) {
	return Math.max(0, Math.min(1, Number(value) || 0));
}
function smoothstep$1(edge0, edge1, value) {
	const progress = clamp01$3((value - edge0) / (edge1 - edge0));
	return progress * progress * (3 - 2 * progress);
}
function signedDistanceToTriangle(x, y) {
	let minimumSquaredDistance = Infinity;
	let inside = true;
	for (let index = 0; index < TRIANGLE_POINTS.length; index++) {
		const start = TRIANGLE_POINTS[index];
		const end = TRIANGLE_POINTS[(index + 1) % TRIANGLE_POINTS.length];
		const edgeX = end[0] - start[0];
		const edgeY = end[1] - start[1];
		const offsetX = x - start[0];
		const offsetY = y - start[1];
		const edgeLengthSquared = edgeX * edgeX + edgeY * edgeY;
		const progress = clamp01$3((offsetX * edgeX + offsetY * edgeY) / edgeLengthSquared);
		const nearestX = offsetX - edgeX * progress;
		const nearestY = offsetY - edgeY * progress;
		minimumSquaredDistance = Math.min(minimumSquaredDistance, nearestX * nearestX + nearestY * nearestY);
		inside &&= edgeX * offsetY - edgeY * offsetX >= 0;
	}
	return Math.sqrt(minimumSquaredDistance) * (inside ? -1 : 1);
}
function signedDistanceToRoundedTriangle(x, y, roundness) {
	const amount = clamp01$3(roundness);
	if (amount >= 1) return Math.hypot(x, y) - 1;
	const triangleScale = Math.max(1e-6, 1 - amount);
	return signedDistanceToTriangle(x / triangleScale, y / triangleScale) * triangleScale - amount;
}
/** 把圆角轮廓内的采样点压回原三角内部，避免读取透明区的暗 RGB。 */
function mapRoundedTriangleTextureUv(u, v, roundness) {
	const amount = clamp01$3(roundness);
	const divisor = 1 + TRIANGLE_TEXTURE_INSET_RATE * amount;
	return [.5 + ((Number(u) || 0) - .5) / divisor, .5 + ((Number(v) || 0) - .5) / divisor];
}
/** 同一归一化形状函数供 Canvas 测试与 GPU Shader 对齐。 */
function sampleRoundedTriangleCoverage(u, v, roundness, pixelFootprint = 1 / 128) {
	const amount = clamp01$3(roundness);
	const distance = signedDistanceToRoundedTriangle((Number(u) || 0) * 2 - 1, (Number(v) || 0) * 2 - 1, amount);
	const feather = Math.max(1e-6, Number(pixelFootprint) || 0) * 2;
	return 1 - smoothstep$1(-feather, feather, distance);
}
function createRoundedTriangleCoverage(roundness) {
	const amount = clamp01$3(roundness);
	const output = /* @__PURE__ */ new Uint8Array(16384);
	for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) output[y * 128 + x] = Math.round(sampleRoundedTriangleCoverage((x + .5) / 128, (y + .5) / 128, amount) * 255);
	return output;
}
const PALETTE_BASE64 = "AAAAAK2urbT/+/////////f39/+kpKS2OTo5GQAAACSqp6qRpKSkkf///9oQDBAOVVVVbaqqqtpVVVVIpaalpKqrqrYABAAAAAAAFwAEACRlY2VxVVdVbRgYGAj/+//b3t/e3lVTVUiqp6q2qqqqtlVTVSRVVVUkqqqqkRAUEBP38/fsAAAAIVpXWm1SUVJlCAQIAKyrrNrCwcLIWldaSEpFSkGko6S29/P3/6SmpLako6SRpKakkefj5+T39/faWllaWgAEACL3+/fxUlZSZ1JTUm3FxcXl9/P32lJRUktSU1JIp6intvf79/+sq6y2CAQIJAgMCCSnqKeRrKuskQgMCAD3+/fa//v/2mNlY2SlpqWnCAgIJFdVV21aWVptCAgIAFdVV0haWVpIvbq9wD8+Pzavq6+aEAwQFU9PT23v7+//UlJSbe/v79pPT09IUlJSSK2ura8hJCElp6enkaSopJFXV1dtUlZSbcbDxshCQUI5r7CvnBAUEBn38/fzVVZVbVVWVUiqqKq2KSwpK+fr5/tNTk0jrKqskZqcmo/////pa2lraaqrqtpVV1VI9/f396SnpJGEgoSCAAAAElpaWkmkp6S2rKystggICAFPT08k7+/v/VJSUiSfn5+Q////63Nxc3MFBQUFV1ZXSKyqrLaMjoyMn5+fkQAAABRfXV9uEAwQAq+ur9rOy87LCAgICEpKSl+6uLrDMSwxLaSipJFSUVJt1tPW00JFQkTn5+fkTU1NYQ==";
const RUNS_BASE64 = "/wD/AP8A/wD/AP8A/wD/AIsAAQEEAnQDAQQBBQUAAQYEAnQDAQQBBwYAAQgDAnQDAQkIAAEKdQMBCgELCAABDHUDAQwKAAENcwMBDQsAAQ5zAwEODAABDwQCbQMBEAIRCwABEgQCbQMBEwIRDAABFAMCbAMBFQMRDAABFgEXAgJrAwEYBBENAAEZAgJrAwEOEgABGgECagMBGxMAARwBAmoDAR0UAAEIaQMBHhUAAR8BCmcDASABIRYAASJnAwEjFwABJAElZQMBJhgAASQBJ2UDASgYAAIRASkBKmADAgQBKwERGAACEQETASpgAwIEARMBERgAAxEBLGADAQQBLQIRGAAEEQEuXwMBLwMRHAABDl8DATAgAAEbXQMBGyEAAR1dAwEdIgABHlsDAR4hAAIRATEBMlgDAioBEwERIAADEQEzWAMBKgE0AhEgAAQRATVXAwE2AxEgAAQRATdXAwE4AxEkAAEkATkCOlADAwIBOygAASQBPAI6UAMDAgE9KAACJAE+ATpQAwICAT8BQCgAAyQBQVADAQIBQgJAKwABQ1EDAQwuAAENTwMBDS8AAQ5PAwEOMAABG00DAUQwAAEkATwCBEgDAwIBRTAAAiQBRgEESAMCAgFHAUgwAAMkAS9IAwECAUICSDAAAyQBSUgDAQIBSgJINAABGgMCQAMEAgFLNwABHAMCQAMEAgFMOAABCAICQAMDAgFNOQABBwICQAMDAgFOOgABTwFQQAMCBAFRPAABUkADAQQBLz0AAVNAAwEEAVQ+AAFVPwMBBT8AAUUDBDgDBDoBVj8AAUgBVwIEOAMDOgFYQAACSAEvAQQ4AwI6AUEBEUAAAkgBWQEEOAMCOgFaARFDAAFbOQMBDUUAAVw5AwEORgABXTcDAR5HAAFeNgMBXwEHRwABEQFgAgIzAwEiSAACEQFCAQIyAwEKASRIAAIRAWEBAjIDAScBJEgAAxEBYjEDATsCJEsAAWMEAiwDAWQBZU4AAWYDAiwDAWdPAAFIAUICAisDAWhQAAFIAUcCAisDAWlSAAENKwMBagERUgABDisDAWsBEVMAARspAwEQAhFTAAEHAWwoAwETAhFUAAFtAzokAwFuWAABQQI6IwMBCgFvWAABOAI6IwMBcFoAAXEBOiIDAXIBc1oAAXQBdSADAgQBdlwAAXcgAwEEAQldAAEHAXgfAwEEAQdeAAF5HwMBUV8AASQBQQI6GAMDAgFCAXpfAAEkAXsCOhgDAwIBSmAAAiQBOQE6GAMCAgF8AUhgAAIkATwBOhgDAgIBRQFIYwABfRgDAVABfmUAAX8BChcDAVJnAAGAFwMBT2cAAYEBghUDAYNoAAERAWECAhMDASdoAAIRAWIBAhIDATsBJGgAAhEBEwECEgMBPAEkaAADEQFgEQMBIgIkawABhAFCAwIMAwEYbwABGQMCDAMBhXAAARoCAgsDAYZxAAEcAgILAwGHcgABiAEqCgMBPwEkcgABBwE2CQMBCgE8ASRzAAGJCQMBIgIkdAABigcDASUDJHQAATgDOgQCAYt4AAFxAjoDAgF8eQABBwI6AwIBRXoAAW0BOgICAWYBSHsAAYwBKgE2fQABjQEqAYl+AAGI/wD/AMEA";
const COVERAGE_RUNS_BASE64 = "/wD/AP8A/wD/AP8A/wD/AIsAAa54/wH3AaQFAAEZeP8B9wcAAZF3/wGRCAAB2nX/AdoBDggAAVV1/wFVCgABqnP/AaoLAAFIc/8BSAwAAaRx/wGrDgBx/wEEDgABZW//AVcPAAEIAdtt/wHeEQABSG3/AUgSAAGqa/8BqhMAASRr/wEkFAABkWn/AZEVAAETAdpn/wHsFwABWmf/AVIYAAGsZf8BwhkAAUhl/wFBGgABpAH3YP8C9wGmGwABBAH3YP8C9wEEHAABkWD/AfcBkR4AAeRf/wHaHwABSF//AVogAAGqXf8BqiEAASRd/wEkIgABkVv/AZEjAAEEAfFY/wL3AQQkAAFWWP8B9wFTJgABxVf/AdonAAFLV/8BSCgAAagC+1P/AawpAAEIAvtT/wEMKgABkQH7Uv8BkSwAAdpR/wHaLQABZFH/AVUuAAGqT/8Bqi8AAUhP/wFIMAABqk3/AaYxAAEIAvdL/wEIMgABVwH3Sv8BWjQAAdpJ/wHaNQABSEn/AUg2AAGqR/8BvTcAASRH/wE2OAABkUX/AZo6AEX/ARA6AAFPAe9A/wL3AVI8AAHaQP8B9wHaPQABSED/AfcBSD4AAa4//wGkPwABCAP3OP8E+wEkQAABkQL3OP8D+wGRQgAB2gH3OP8C+wHaQwABVwH3OP8C+wFWRAABxjn/AapFAAE5Of8BSEYAAZw3/wGRRwABFDb/AfNJAAFWNf8BWkoAAdoz/wHaSwABSDP/AUhMAAGqMf8BrE0AASsw/wHrASNOAAGRL/8Bj1AAAdot/wHpUQABWi3/AWlSAAGqK/8Bq1MAAUgr/wFIVAABqin/AatWAAH3KP8BBFYAAZED+yT/AYJYAAHaAvsj/wHaWQABSAL7I/8BSVoAAacB+yL/AawBAVoAASQB7yD/AvcBJFwAAZAg/wH3AZFeAAHrH/8B918AAXMf/wFSYAAB2gL7G/8B2gEFYAABSAL7G/8BSGIAAagB+xr/AaxjAAEIAfsa/wEIZAABjBj/Ae8BkWYAAdoX/wHaZwABXxf/AU9nAAECAa8V/wHLaQABSBX/AUhqAAGqE/8BrGsAAQQT/wEIbAABVhH/AVptAAEIAdoP/wHebwABSA//AUpwAAGqDf8BunEAASQN/wEtcgABkQH3Cv8BkXQAAdoJ/wHaAQh0AAFSCf8BWnYAAdMH/wGsdwABSAP7BP8BRHgAAacC+wP/Aax6AAL7A/8BCHoAAZEB+wL/AZF8AAHkAfcB2n0AAU0B9wFSfgABkf8A/wDBAA==";
function decodeBase64$1(value) {
	const binary = globalThis.atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
function decodeTriangleTexture() {
	const palette = decodeBase64$1(PALETTE_BASE64);
	const runs = decodeBase64$1(RUNS_BASE64);
	const output = /* @__PURE__ */ new Uint8Array(65536);
	let outputOffset = 0;
	for (let runOffset = 0; runOffset < runs.length; runOffset += 2) {
		const count = runs[runOffset];
		const paletteOffset = runs[runOffset + 1] * 4;
		for (let index = 0; index < count; index++) {
			output[outputOffset] = palette[paletteOffset];
			output[outputOffset + 1] = palette[paletteOffset + 1];
			output[outputOffset + 2] = palette[paletteOffset + 2];
			output[outputOffset + 3] = palette[paletteOffset + 3];
			outputOffset += 4;
		}
	}
	if (outputOffset !== output.length) throw new Error("三角纹理 RLE 长度无效");
	return output;
}
function decodeTriangleCoverage() {
	const runs = decodeBase64$1(COVERAGE_RUNS_BASE64);
	const output = /* @__PURE__ */ new Uint8Array(16384);
	let outputOffset = 0;
	for (let runOffset = 0; runOffset < runs.length; runOffset += 2) {
		const count = runs[runOffset];
		const value = runs[runOffset + 1];
		output.fill(value, outputOffset, outputOffset + count);
		outputOffset += count;
	}
	if (outputOffset !== output.length) throw new Error("三角 Coverage RLE 长度无效");
	return output;
}
function srgbByteToLinearByte$1(value) {
	const normalized = value / 255;
	const linear = normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
	return Math.round(linear * 255);
}
const TRIANGLE_TEXTURE_RGBA = decodeTriangleTexture();
const TRIANGLE_TEXTURE_COVERAGE = decodeTriangleCoverage();
const TRIANGLE_TEXTURE_OVERLAY_RGBA = (() => {
	const output = TRIANGLE_TEXTURE_RGBA.slice();
	for (let index = 0; index < TRIANGLE_TEXTURE_COVERAGE.length; index++) output[index * 4 + 3] = TRIANGLE_TEXTURE_COVERAGE[index];
	return output;
})();
function resolveTriangleTextureFrame(textureFrame) {
	if (Number.isFinite(textureFrame)) return (Math.trunc(textureFrame) % 2 + 2) % 2;
	if (!Array.isArray(textureFrame) || textureFrame.length < 3) return 0;
	const verticalPositions = textureFrame.map((point) => Number(point?.[1])).filter((value) => Number.isFinite(value));
	if (verticalPositions.length < 3) return 0;
	const minimum = Math.min(...verticalPositions);
	const maximum = Math.max(...verticalPositions);
	const epsilon = Math.max(1e-6, (maximum - minimum) * .001);
	return verticalPositions.filter((value) => Math.abs(value - minimum) <= epsilon).length < verticalPositions.filter((value) => Math.abs(value - maximum) <= epsilon).length ? 1 : 0;
}
function createTriangleTextureSources(createCanvas) {
	if (typeof createCanvas !== "function") return null;
	const colorCanvas = createCanvas();
	const srgbColorCanvas = createCanvas();
	const alphaCanvas = createCanvas();
	const coverageCanvas = createCanvas();
	colorCanvas.width = 128;
	colorCanvas.height = 128;
	srgbColorCanvas.width = 128;
	srgbColorCanvas.height = 128;
	alphaCanvas.width = 128;
	alphaCanvas.height = 128;
	coverageCanvas.width = 128;
	coverageCanvas.height = 128;
	const colorContext = colorCanvas.getContext("2d");
	const srgbColorContext = srgbColorCanvas.getContext("2d");
	const alphaContext = alphaCanvas.getContext("2d");
	const coverageContext = coverageCanvas.getContext("2d");
	if (!colorContext || !srgbColorContext || !alphaContext || !coverageContext || typeof colorContext.createImageData !== "function" || typeof srgbColorContext.createImageData !== "function" || typeof alphaContext.createImageData !== "function" || typeof coverageContext.createImageData !== "function") {
		colorCanvas.width = 0;
		colorCanvas.height = 0;
		srgbColorCanvas.width = 0;
		srgbColorCanvas.height = 0;
		alphaCanvas.width = 0;
		alphaCanvas.height = 0;
		coverageCanvas.width = 0;
		coverageCanvas.height = 0;
		return null;
	}
	const colorImage = colorContext.createImageData(128, 128);
	const srgbColorImage = srgbColorContext.createImageData(128, 128);
	const alphaImage = alphaContext.createImageData(128, 128);
	const coverageImage = coverageContext.createImageData(128, 128);
	for (let offset = 0; offset < TRIANGLE_TEXTURE_RGBA.length; offset += 4) {
		colorImage.data[offset] = srgbByteToLinearByte$1(TRIANGLE_TEXTURE_RGBA[offset]);
		colorImage.data[offset + 1] = srgbByteToLinearByte$1(TRIANGLE_TEXTURE_RGBA[offset + 1]);
		colorImage.data[offset + 2] = srgbByteToLinearByte$1(TRIANGLE_TEXTURE_RGBA[offset + 2]);
		colorImage.data[offset + 3] = 255;
		srgbColorImage.data[offset] = TRIANGLE_TEXTURE_RGBA[offset];
		srgbColorImage.data[offset + 1] = TRIANGLE_TEXTURE_RGBA[offset + 1];
		srgbColorImage.data[offset + 2] = TRIANGLE_TEXTURE_RGBA[offset + 2];
		srgbColorImage.data[offset + 3] = 255;
		alphaImage.data[offset] = 255;
		alphaImage.data[offset + 1] = 255;
		alphaImage.data[offset + 2] = 255;
		alphaImage.data[offset + 3] = TRIANGLE_TEXTURE_RGBA[offset + 3];
		coverageImage.data[offset] = 255;
		coverageImage.data[offset + 1] = 255;
		coverageImage.data[offset + 2] = 255;
		coverageImage.data[offset + 3] = TRIANGLE_TEXTURE_COVERAGE[offset / 4];
	}
	colorContext.putImageData(colorImage, 0, 0);
	srgbColorContext.putImageData(srgbColorImage, 0, 0);
	alphaContext.putImageData(alphaImage, 0, 0);
	coverageContext.putImageData(coverageImage, 0, 0);
	return {
		colorCanvas,
		srgbColorCanvas,
		alphaCanvas,
		coverageCanvas
	};
}
const RUNS_BASE64_CHUNKS = Object.freeze([
	"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ATk4AUpIAjEwARgYAg0NegAAAQsKARYVAiYjAjw6A19iAY6QAdDR////IP//Abe3A3h3AkpIAjEwARsaAg0NdwAAAQsKARYVASEgASYjAjw6AVJRAl9iAY6QAb2+////If//Aff3Abe3Anh3AWNhAkpIATEwASkoAhsaAQ0NAQAEcwAAAhAUAigrA0JBAXZ1AXNxAaGgAdDP////JP//AdvaAZSSAYOEA1JRAjk1AiEcARAOcQAAAQsMARAUAigrAUFCAkJBAnZ1AaGgAdDP////Jv//AdvaAbW3AYOEAlJRAVJPAjk1ASEcASAdARAObQAAAgsMARYYAigrAkFCAUJBAnZ1Aaqq////Kf//AefrAbW3AYOEAVJRAlJPAjk1AiAdARAOagAAAgsMARYYASEkASgrAkFCAVpZAnZ1AaqqAd7f////Kf//AufrAbW3AYOEAWtpAlJPATk1ATEsAiAdARAOAQUFZwAAAhgUAjEsA0pNAYOEAYSCAa2r////Lv//Ab26AoOEAkpJAjw7AiEgARAQZAAAAg0MARgUAjEsAUpEAkpNAoOEAa2r////MP//Ab2/AoOEAUpJAVdWAjw7ASEgASAgARAQYQAAAg0MARsYAjEsAkpEAUpNAoOEAb27////Mf//Aff7Ab2/AoOEAldWAjw7AiAgARAQXgAAAg0MARsYASkkATEsAkpEAWNdAoOEAb27Affz////Mf//Avf7Ab2/AYOEAXNxAldWATw7ATEwAiAgARAQAQgIWwAAAhgYAjEwA1JRAYuLAYSGAdbW////Nv//AdbXAouLAlJRAjw9AiEkARAQWwAAAjEwAUpI",
	"AlJRAouLAdbW////OP//AcXFAouLAVJRAVdXAjw9ASEkASAgARAQWgAAAkpIAVJRAouLAcXF////Ov//AcXFAouLAldXAjw9AiAgARAQWQAAAWNhAouLAcXF////PP//AcXFAYuLAXNxAldXATw9ATEwAiAgARAQAQUFVwAAAYyOAdjZ////Pv//Ad7bAouLAlJRAjw7AiEgAQ0OVwAA////QP//AcXFAouLAVJRAVdWAjw7ASEgARsdAQ0OVgAA////QP//AcXFAouLAldWAjw7ASksARsdAQ0OVQAA////QP//AcXFAYuLAXNxAldWATw7AiksARsdAQ0OAQAEUwAA////QP//Ad7bAouJAlJRAjk3AiEcAQ0NUwAA////QP//AcXCAouJAVJRAVJSAjk3ASEcARsaAQ0NUgAA////P///Af/7AcXCAYuJAVJRAlJSAjk3ASkoARsaAQ0NUQAA////Pv//Av/7AcXCAYuJAWttAlJSATk3ASkoARsaAg0NUAAA////QP//Ab3DAoGDAkpNAURGAS4vAhgYAQ0MTwAA////QP//Abi5AoGDAUpNAURGAi4vARgYAg0MTgAA////P///Ae/vAbi5AoGDAVpdAURGAi4vARsYAQ0MTgAA////Pv//Au/vAbi5AYGDAlpdAURGAS4vASkkARsYAQ0MTQAA////P///AeHgAaWiAYOEA0pJATw+ASYnAhAQTAAA////P///AeHgAoOEAkpJATw+AiYnARAQAQgJSwAA////P///Ab2/AoOEAUpJAVJVATw+AiYnARASAQgJSgAA////Pv//Aff7Ab2/AoOEAlJVATw+ASYnARgcARASAQgJSQAA////Pf//Av/7AdPRAXt9Am5vAkJBAh4cAggISAAA////PP//A//7AaenAm5vAkJBATQwAh4cAQgIAQUFRwAA////O///BP/7AZqdAm5vAUJBAUpFATQwAh4cAQoKRwAA////Ov//BP/7AcbLAZqdAm5vAUpFAjQwAR4cARAQAQUFRgAA////Pf//Af/7AdDOAnN1Ak9OAjEwASYiARMRRgAA////PP//Av/7AdDOAXN1AW1sAk9OATEwASYiAhMRRQAA////O///A//7AaGhAm1sAk9OATk0ASYiAhMRRAAA////Ov//BP/7AYyKAm1sAU9OATk0AiYiARMRAQgIQwAA////Pf//AcXJAZSXAmNlAVJQATk4AiEgAQ0OQwAA////PP//Aff7AcXJAmNlAVJQAjk4ASEgARsdAQ0OQgAA////O///Avf7AZSXAWNlAWtpAVJQAjk4ARsdAg0OQQAA////Ov//A/f7AZSXAmtpAVJQATk4ASksARsdAQ0OQQAA////PP//AdbXAYaHA1JRATw/ASYpAhAUQAAA////PP//Abq9AYaHAlJRATw/AiYpARAUAQgIPwAA////O///Ae/zAbq9AYaHAVJRAVJVATw/AiYpARAQAQgIPgAA////Ov//Au/zAoaHAlJVATw/ASYpARgYARAQPgAA////O///AdPTAXt9AmVmAjk8ASYpARMWAgAEPAAA////O///AaeoA2VmATk8AiYpARMWAQAEPAAA////Ov//AdPTAZGQAmVmAjk8ASYpAhMWAQICOwAA////Ov//Ab26AZGQAmVmAjk8ASYpARMWAQgIOwAA////Of//Aff7AZmcAmttAVJSATk7AiEkAQ0NOwAA////OP//Avf7AZmcAWttAlJSATk7ASEkARsaAQ0NOgAA////N///Avf7AcjLAWttAWtpAVJSAjk7ASkoAg0NOQAA////Nv//A/f7AZmcAmtpAVJSATk7ASkoARsaAQ0NOQAA////OP//Ad7bAoGBAkpJATQ3Ah4hAQgMOAAA////OP//Abi6AYGBAkpJAjQ3AR4hAQgMAQUGNwAA////N///Ae/zAoGBAUpJAUpNATQ3Ah4hAQoNNwAA////Nv//Ae/zAbi6AoGBAkpNATQ3AR4hARAUAQUGNgAA////Nf//Av/7AaekAXt5AWttAkpMASksASAkARAUAgAENAAA////NP//Av/7AdPPAXt5AWttAkpMASksASAkARAUAgAENAAA////M///A//7AaekAmttAkpMATE0ASAkARAUAQAENAAA////Mv//BP/7AYyOAmttAUpMATE0ASAkAhAUNAAA////Nf//AcLBAY6LAlpVAUFCAigrARAUAQgIMwAA////NP//Aff3Ao6LAVpVAkFCASgrARAUARAQMwAA////M///Aff3AcLBAY6LAVpVAVpZAUFCAigrARAQAQgIMgAA////Mv//Avf3AcLBAY6LAVpZAkFCASgrARgYARAQMgAA////M///AdjYAYyKAl9gAjk8ASYmARMVAgAEMAAA////M///AbKxAYaFAl9gATk8ASYmAhMVAQAEMAAA////Mv//AdjYAYaFAl9gATk8ATk4ASYmARMVAQAEMAAA////Mv//Aa2qAYaFAl9gATk4ASYmAhMVMAAA////Mf//Aff3AY6QAlpdAUREAS4wAhgcAQgILwAA////MP//Aff3AcLDAY6QAVpdAVpZAUREAS4wARgcARAQLwAA////L///Avf3AY6QAVpdAVpZAUREAS4wARgcARgYAQgILgAA////Lv//Avf3AcLDAY6QAlpZAUREAS4wARgYARAQLgAA////L///Ad7dAZyaAmJjAjk8ASYmARMVAgAELAAA////L///Ab27AYuKAmJjATk8ASYmAhMVAQAELAAA////Lv//Ad7dAYuKAmJjATk8ATk4ASYmARMVAQAELAAA////Lv//AbWyAYuKAWJjATk8ATk4ASYmAhMVLAAA////Lf//Aff3AY6QAlpdAUREAS4sAhgUAQgIKwAA////LP//Aff3AcLDAY6QAVpdAkREAS4sARgUAQgIKwAA////K///Avf3AY6QAlpdAUREAS4sARgUARAQAQgIKgAA////Kv//Avf3AcLDAlpdAUREAi4sARgYAQgIKgAA////K///AdPTAXt9AWttAkpMASksASAdARAOKgAA////K///AaeoAmttAUpMASksASAdAhAOKQAA////Kv//AdPTAmttAkpMATEsASAdARAOKQAA////Kv//AYyOAWttAkpMATEsASAdARAOKQAA////Kf//Abq9AYaHAlJRATQ3Ah4hAQgMKAAA",
	"////KP//Ae/zAYaHAlJRAUpNATQ3AR4hAQgMAQUEJwAA////J///Ae/zAbq9AYaHAVJRAUpNATQ3Ah4hAQoIJwAA////Jv//Au/zAYaHAVJRAUpNAjQ3AR4hARAMAQUEJgAA////J///AaGgAXNxAVdXAjw9ASEkARYVAQsKJgAA////Jv//AdDPAXNxAldXATw9ASEkARYVAQsKJgAA////Jf//AdDPAnNxAVdXAjw9ASEgAQsKJgAA////Jf//AaGgAXNxAVdXAjw9ASEgARYVAQsKJQAA////JP//AdbXAnN0AkJFASYpAhMWAQAEJAAA////I///AfHxAaSjAXN0AkJFATk8ASYpARMWAQAEJAAA////I///AaSjAnN0AUJFATk8ASYpARMWAQAEJAAA////Iv//AdbTAnN0AUJFATk8ASYpAhMWJAAA////If//Aff3AZSTAmNhAUFAAigoARAQAQUFIwAA////IP//Aff3AcXFAmNhAkFAASgoARAQAQoKIwAA////H///Avf3AZSTAWNhAVpZAUFAAigoARAQAQUFIgAA////Hv//Avf3AZSTAWNhAVpZAUFAAigoARAQAQUFIgAA////H///AdPSAXt5AVpaAkFDASksARYYAQsMIgAA////Hv//AdPSAXt5AXNxAVpaAUFDASksASEkAQsMIgAA////Hv//AaelAXNxAVpaAUFDASksASEkARYYAQsMIQAA////Hf//AdPSAXNxAVpaAkFDASEkARYYAQsMIQAA////HP//AefnAnN1AkJFASYmAhMVAQAEIAAA////G///Aff3AaSmAXN1AkJFATk4ASYmARMVAQAEIAAA////G///AdbXAnN1AUJFATk4ASYmARMVAQAEIAAA////Gv//AdbXAnN1AUJFATk4ASYmAhMVIAAA////Gf//Aff3AZSTAmNhATw7AiYlARAQAQUEHwAA////GP//Aff3AcXFAmNhAVJRATw7ASYlARAQAQUEHwAA////F///Aff3AcXFAmNhAVJRATw7ASYlARAQAQoIHwAA////Fv//Avf3AZSTAWNhAVJRATw7AiYlARAMHwAA////Ff//Av/7AaGfAXNxAVJPAjk5ASEkARYSHwAA////FP//Av/7AdDNAXNxAWtlAVJPATk5ASEkARYSAQsJHgAA////E///Av/7AdDNAXNxAWtlAVJPATk5ASEkARYSAQsJHgAA////Ev//A//7AaGfAWtlAVJPAjk5ASEcAQsJHgAA////FP//Aa2uAXBuAVRTAjk4ARsdAQ0OHgAA////E///AcjJAXBuAlRTATk4ASksARsdAQ0OHQAA////Ev//AePkAnBuAVRTATk4ASksARsdAQ0OHQAA////Ef//AePkAYyKAXBuAVRTATk4ASksARsdAQ0OHQAA////Ef//AayuAXt9AkpNATk8ASgpARgWAQgEHAAA////EP//AayuAXt9AkpNATk8ASgpARgWAQgEHAAA////D///Ad7fAnt9AUpNATk8ASgpARgWAQgEHAAA////Dv//Ad7fAnt9AUpNATk8ASgpARgWAQgEHAAA////Df//Af/7AZeUAmNhAUpNATY6ASMnARAUAQICGwAA////DP//Af/7AcvHAmNhAUpNATY6ASMnARAUAQUFGwAA////C///Af/7AcvHAmNhAUpNATY6ASMnARAUAQgIGwAA////Cv//Af/7AcvHAZeUAWNhAUpNATY6ASMnARAUAQgIGwAA////Cf//Av/7AnNxAVpdAUdIATQ0ASEgAQoNGwAA////CP//Av/7AaGfAXNxAVpdAUdIATQ0ASEgARAUAQUGGgAA////B///Av/7AaGfAXNxAVpdAUdIATQ0ASEgARAUAQUGGgAA////Bv//Av/7AdDNAXNxAVpdAUdIATQ0ASEgARAUAQUGGgAA////Bf//Av/7AdPRAXt9AWttAVVXAT9BASksARYVAQsKGgAA////BP//A//7AXt9AWttAVVXAT9BASksARYVAQsKGgAA////A///A//7AaenAWttAVVXAT9BASksASEgAQsKGgAA////Av//A//7AaenAWttAVVXAT9BASksASEgAQsKGgAA////BP//Ab26AXt9AWVmAU9PATk4ASEkARYYAQsMGQAA////A///AdPRAXt9AWVmAU9PATk4ASEkARYYAQsMGQAA////Av//AdPRAXt9AWVmAU9PATk4ASEkARYYAQsMGQAA////Af//AenoAXt9AWVmAU9PATk4ASEkARYYAQsMGQAA////AffzAY6QAWhqAkJFATEwASAgARAQGQAA/v//Afz7AY6QAmhqAUJFATEwASAgARAQGQAA/v//AbW2AmhqAUJFATEwASAgARAQGQAA/f//AbW2AmhqAUJFATEwASAgARAQGQAA/P//Ad7jAYCBAlJRATk4ASgoARgYAQgIGAAA+///Ad7jAYCBAlJRATk4ASgoARgYAQgIGAAA+v//Ad7jAYCBAlJRATk4ASgoARgYAQgIGAAA+f//Ad7jAYCBAlJRATk4ASgoARgYAQgIGAAA+P//Aff3AY6NAlpZAUJBATEvASAdARAMAQABFwAA9///Aff3AY6NAlpZAUJBATEvASAdARAMAQABFwAA9v//Aff3AY6NAlpZAUJBATEvASAdARAMAQACFwAA9f//Aff3AcLCAlpZAUJBATEvASAdARAMAQAEFwAA9P//Af/7AcjFAlpZAUpJATY2ASMjARAQAQUFFwAA8///Af/7AcjFAZGPAVpZAUpJATY2ASMjARAQAQUFFwAA8v//Af/7AcjFAZGPAVpZAUpJATY2ASMjARAQAQUFFwAA8f//Af/7AcjFAZGPAVpZAUpJATY2ASMjARAQAQgIFwAA8P//Aff3AcXGAmNlAVJRAT4+ASsrARgYAQgIFwAA7///Avf3AZSVAWNlAVJRAT4+ASsrARgYAQgIFwAA7v//Avf3AZSVAWNlAVJRAT4+ASsrARgYAQgIFwAA7f//Avf3AZSVAWNlAVJRAT4+ASsrARgYAQgIFwAA7P//Avf7AZmZAWtpAVJVAT5AASssARgYAQoIFwAA6///Avf7AZmZAWtpAVJVAT5AASssARgYAQoIFwAA6v//Avf7AZmZAWtpAVJVAT5AASssARgYARAMFwAA6f//Avf7AZmZAWtpAVJVAT5AASss",
	"ARgYARAMFwAA6v//AaGgAXNxAVpZAUdEATQwASEcARAMFwAA6f//AaGgAXNxAVpZAUdEATQwASEcARAMFwAA6P//AaGgAXNxAVpZAUdEATQwASEcARAMFwAA5///AaGgAXNxAVpZAUdEATQwASEcARAMAQUEFgAA5v//AaGjAXN1AVpZAUdEATQwASEcARAMAQUEFgAA5f//AaGjAXN1AVpZAUdEATQwASEcARAMAQUEFgAA5P//AaGjAXN1AVpZAUdEATQwASEcARAMAQUEFgAA4///AaGjAXN1AVpZAUdEATQwASEcARAMAQUEFgAA4v//AaGjAXN1AVpZAUdEATQwASEcARAMAQUEFgAA4f//AaGjAXN1AVpZAUdEATQwASEcARAMAQUEFgAA4P//AaGjAXN1AVpZAUdEATQwASEcARAMAQUEFgAA3///AaGjAXN1AVpZAUdEATQwASEcARAMAQUEFgAA3v//AaGjAXN1AVpZAUdEATQwASEcARAMAQUEFgAA3f//AaGjAXN1AVpZAUdEATQwASEcARAMAQUEFgAA3P//AaGjAXN1AVpZAUdEATQwASEcARAMFwAA2///AaGjAXN1AVpZAUdEATQwASEcARAMFwAA2P//Av/7AZyZAWtpAVJVAT5CASsvARgcARAMFwAA1///Av/7AZyZAWtpAVJVAT5CASsvARgcARAMFwAA1v//Av/7AZyZAWtpAVJVAT5CASsvARgcARAMFwAA1f//Av/7AZyZAWtpAVJVAT5CASsvARgcAQoIFwAA1P//Au/zAZGPAWNdAVJRAT4+ASsrARgYAQgIFwAA0///Au/zAZGPAWNdAVJRAT4+ASsrARgYAQgIFwAA0v//Au/zAZGPAWNdAVJRAT4+ASsrARgYAQgIFwAA0f//Au/zAZGPAWNdAVJRAT4+ASsrARgYAQgIFwAA0f//Ac3OAmttAUpNATY6ASMnARAUAQgIFwAA0P//Ac3OAmttAUpNATY6ASMnARAUAQgIFwAAz///Ac3OAmttAUpNATY6ASMnARAUAQUFFwAAzv//Ac3OAmttAUpNATY6ASMnARAUAQUFFwAAzP//Aff7AcXJAmNlAUJFATEyASAfARAMAQUCFwAAy///Aff7AcXJAmNlAUJFATEyASAfARAMAQUCFwAAyv//Aff7AZSXAmNlAUJFATEyASAfARAMAQIBFwAAyf//Aff7AZSXAmNlAUJFATEyASAfARAMAQIBFwAAyP//Ad7jAoCBAVJRATk8ASgqARgZAQgIGAAAx///Ad7jAYCBAlJRATk8ASgqARgZAQgIGAAAxv//Ad7jAYCBAlJRATk8ASgqARgZAQgIGAAAxf//Ad7jAYCBAlJRATk8ASgqARgZAQgIGAAAxP//AcbHAnNwAUpFATEwASAgARAQGQAAw///AcbHAnNwAUpFATEwASAgARAQGQAAwv//AZybAXNwAkpFATEwASAgARAQGQAAwP//Afz9AZybAXNwAkpFATEwASAgARAQGQAAv///Ae7tAYyKAXBwAVRWATk8ASkoARsaAQ0NGQAAvv//Ae7tAYyKAXBwAVRWATk8ASkoARsaAQ0NGQAAvf//Ad7cAnBwAVRWATk8ASkoARsaAQ0NGQAAvP//Ac7LAXBwAlRWATk8ASkoARsaAQ0NGQAAuP//A//7AaenAWttAVdYAUREATEwASEgARYVAQsKGQAAt///A//7AaenAWttAVdYAUREATEwASEgAQsKGgAAtv//A//7AaenAWttAVdYAUREATEwASEgAQsKGgAAtf//A//7AXt9AWttAVdYAUREATEwARYVAQsKGgAAtv//AdDRAXN1AVpdAUdIATQ0ASEgARgUAQgGGgAAtf//AdDRAXN1AVpdAUdIATQ0ASEgARgUAQgGGgAAtP//AaGjAXN1AVpdAUdIATQ0ASEgARANAQgGGgAAs///AaGjAXN1AVpdAUdIATQ0ASEgARANGwAAsP//Avf7AZSUAWNhAUpNATY6AiMnARAMGwAAr///Avf7AZSUAWNhAUpNATY6ASMnARAUAQoIGwAArv//Aff7AcXHAmNhAUpNATY6ASMnARAUAQoIGwAArf//Aff7AcXHAmNhAUpNATY6ASMnARAUAQUEGwAArP//AffzAomHAVJRAUJBAS4uARsbAQgIAQAEGwAAq///AffzAYmHAlJRAUJBAS4uARsbAQgIAQABGwAAqv//AffzAYmHAlJRAUJBAS4uARsbAQgIHAAAqf//AcC9AYmHAlJRAS4uAhsbAQgIHAAAqP//AaWmAYGCAV1fATk8ASksARsdAQ0OHQAApv//Ae7tAYGCAl1fATk8ASksARsdAQ0OHQAApf//Ad7cAYGCAl1fATk8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AUpLAjExARYVAQsKMgAAV///Ac3NAmtpAkpLATExARgYARYVAQsKMgAAVv//AZybAmtpAUpLAjExARgYAQsKMwAAVP//AcbDA2hmATk8AiYpARMWAQUFMwAAUv//AdjYAZeUAmhmATk4ATk8ASYpAhMWNAAAUf//AbKxA2hmATk4AiYpARMWAQAENAAAT///AdjYAYyKAmhmAjk4ASYpARMWAgAENAAATP//AvfzAcC+AYmJAlpZAUFCASgrARgYARAQNgAAS///AffzAcC+AYmJAVJVAVpZAUFCAigrARAQAQgINgAASv//AffzAomJAVJVAkFCASgrARAUARAQNwAASf//AcC+AYmJAlJVAUFCAigrARAUAQgINwAAR///AdDPAYSCAmVkAUdGATEwASAgAhAQOAAARv//AaGgAmVkAkdGATEwASAgARAQOQAARP//AdDPAXNxAWVkAkdGASkoASAgARAQOgAAQv//AdDPAnNxAWVkAUdGAikoASAgARAQOgAAQP//AefrAbCwAnl2AUpNAjQ2AR4fARAQAQUFOgAAP///AbCwAnl2AUI8AUpNATQ2Ah4fAQoKOwAAPf//AePiA3l2AUI8ATQ2Ah4fAQgIAQUFOwAAPP//Aa2qAnl2AkI8ATQ2AR4fAggIPAAAOP//Av/7AcjFAZGPAWNlAkpMATE0ASEgARYVAQsKPQAAN///Af/7AcjFAZGPAVpZAWNlAUpMAjE0ARYVAQsKPgAANv//Af/7AZGPAlpZAUpMAjE0ARgcARYVAQsKPgAANf//AcjFAZGPAlpZAUpMATE0AhgcAQsKPwAAMP//A//7AdDNAXt5Al1cAT9AATE0AiAiARARAQAEPwAAL///A//7AaGfAXt5AV1cAj9AATE0ASAiARARQQAALv//Av/7AaGfAXNxAl1cAj9AASAiAhARQQAALf//Af/7AdDNAnNxAV1cAj9AASEkAhARQgAAKP//BP/7Ac7LA2prAUpJAjEyARgbARAQAQUFQgAAJ///BP/7AZybAmprATk8AjEyAhgbAQUFQwAAJv//A//7AaekAmprAjk8ATEyAhgbAQAERAAAJf//Av/7AdPPAXt5AmprAjk8ATEyARgbAgAERAAAJP//Au/vAoGDAlJVATw+ASYnARgYARAQAQgIRQAAI///Ae/vAoGDAUpNAVJVATw+AiYnARAQAQgIRgAAIf//AebmAbi5AYGDAkpNATw+AiYnARAQAQgIRwAAIP//AbW2AYGDA0pNATw+ASYnAhAQSAAAHP//Av/7AcjFAZGPAWtpAk9PATM1ASkoARsaAQ0NSQAAG///Af/7AcjFAZGPAVpZAk9PAjM1ARsaAQ0NSgAAGv//AcjFAZGPAlpZAU9PAjM1ARgcAg0NSgAAGP//AefnAZGPA1pZAjM1AhgcAQ0NSwAAFP//A/fzAY6MAXN1AldaATw/ATEwASAgAhAQTAAAE///AvfzAcK/AY6MAldaAjw/AiAgARAQTQAAEv//AffzAcK/AY6MAVpZAVdaAjw/ASEkASAgARAQTgAAEP//Afz9AcK/AY6MAlpZAjw/AiEkARAQTwAAD///AcjJAXt5Al1cAT9AATk4AiYlARMSAQgITwAADf//AcjJAZGTAXt5AV1cAj9AAiYlARMSUQAAC///AcjJAZGTAVpdAV1cAj9AASEkASYlAhMSUQAACf//AcjJAZGTAlpdAz9AASEkAhMSUgAAB///Ac3NAYSGAmNlAUJEAjk8ASYoARMUAQgMAQIEUgAABf//Ac3NAZybAmNlAkJEATk8ASYoAhMUAQIEUwAAA///Ac3NAZybAWtpAWNlA0JEASYoAhMUVQAAAf//Ac3NAZybAmtpA0JEASEkAhMUVgAAAYyKAm1sAU9OAUJBAiwsARYYARAQAQUFVgAAAW1sAk9OAiwsAhYYAQUFVwAAAU9OATEwASwsAhYYAQAEWAAAATEwAhYYAgAEWAAAARAQAQUF/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA/wAA",
	"/wAA/wAA/wAA/wAA/wAA/wAA/wAAxAAA"
]);
function decodeBase64(value) {
	const binary = globalThis.atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
function decodeBase64Chunks(values) {
	const chunks = values.map(decodeBase64);
	const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
	const output = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}
function writeCirclePixel(output, x, y, red, green) {
	const offset = (y * 512 + x) * 4;
	output[offset] = red;
	output[offset + 1] = green;
	output[offset + 2] = red;
	output[offset + 3] = 255;
}
function decodeCircleTexture() {
	const runs = decodeBase64Chunks(RUNS_BASE64_CHUNKS);
	const output = /* @__PURE__ */ new Uint8Array(1048576);
	let runOffset = 0;
	let runRemaining = 0;
	let runRed = 0;
	let runGreen = 0;
	for (let y = 0; y < 512; y++) for (let x = y; x < 512; x++) {
		if (runRemaining === 0) {
			if (runOffset + 2 >= runs.length) throw new Error("Circle_01 RLE 数据提前结束");
			runRemaining = runs[runOffset];
			runRed = runs[runOffset + 1];
			runGreen = runs[runOffset + 2];
			runOffset += 3;
		}
		writeCirclePixel(output, x, y, runRed, runGreen);
		if (x !== y) writeCirclePixel(output, y, x, runRed, runGreen);
		runRemaining--;
	}
	if (runOffset !== runs.length || runRemaining !== 0) throw new Error("Circle_01 RLE 数据长度不匹配");
	return output;
}
function srgbByteToLinearByte(value) {
	const normalized = value / 255;
	const linear = normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
	return Math.round(linear * 255);
}
const CIRCLE_TEXTURE_RGBA = decodeCircleTexture();
function createCircleTextureSources(createCanvas) {
	if (typeof createCanvas !== "function") return null;
	const colorCanvas = createCanvas();
	const srgbColorCanvas = createCanvas();
	const coverageCanvas = createCanvas();
	colorCanvas.width = 512;
	colorCanvas.height = 512;
	srgbColorCanvas.width = 512;
	srgbColorCanvas.height = 512;
	coverageCanvas.width = 512;
	coverageCanvas.height = 512;
	const colorContext = colorCanvas.getContext("2d");
	const srgbColorContext = srgbColorCanvas.getContext("2d");
	const coverageContext = coverageCanvas.getContext("2d");
	if (!colorContext || !srgbColorContext || !coverageContext || typeof colorContext.createImageData !== "function" || typeof srgbColorContext.createImageData !== "function" || typeof coverageContext.createImageData !== "function") {
		colorCanvas.width = 0;
		colorCanvas.height = 0;
		srgbColorCanvas.width = 0;
		srgbColorCanvas.height = 0;
		coverageCanvas.width = 0;
		coverageCanvas.height = 0;
		return null;
	}
	const colorImage = colorContext.createImageData(512, 512);
	const srgbColorImage = srgbColorContext.createImageData(512, 512);
	const coverageImage = coverageContext.createImageData(512, 512);
	for (let offset = 0; offset < CIRCLE_TEXTURE_RGBA.length; offset += 4) {
		const linearRed = srgbByteToLinearByte(CIRCLE_TEXTURE_RGBA[offset]);
		colorImage.data[offset] = linearRed;
		colorImage.data[offset + 1] = srgbByteToLinearByte(CIRCLE_TEXTURE_RGBA[offset + 1]);
		colorImage.data[offset + 2] = linearRed;
		colorImage.data[offset + 3] = 255;
		srgbColorImage.data[offset] = CIRCLE_TEXTURE_RGBA[offset];
		srgbColorImage.data[offset + 1] = CIRCLE_TEXTURE_RGBA[offset + 1];
		srgbColorImage.data[offset + 2] = CIRCLE_TEXTURE_RGBA[offset + 2];
		srgbColorImage.data[offset + 3] = 255;
		coverageImage.data[offset] = 255;
		coverageImage.data[offset + 1] = 255;
		coverageImage.data[offset + 2] = 255;
		coverageImage.data[offset + 3] = linearRed;
	}
	colorContext.putImageData(colorImage, 0, 0);
	srgbColorContext.putImageData(srgbColorImage, 0, 0);
	coverageContext.putImageData(coverageImage, 0, 0);
	return {
		colorCanvas,
		srgbColorCanvas,
		coverageCanvas
	};
}
const RING3_PREDICTOR_BYTES = 384;
const RING3_RESIDUAL_OFFSET = 7;
const RING3_PAYLOAD_LENGTH = 16768;
const PACKED_RING3_ALPHA = [
	"BwIBAwQEBAQGBgcJCAgLCAsMDA4OEBASEhQVFhgYGBseHh8hIyUmKCsrLC4xMTM2OTo9QEBCREhMTE5RU1RbW19hYmVnbG9xc3h4",
	"fYCChYeIjI6TlJmZnqKmpquusLO0uLu8wMPEyMvN0dTY1tjb3OPm5uvq7e7v8/b29vr8/////fz5+PTz8e7t7erp5eXi39zX2NPT",
	"0M7LxsPFvr65t7WysKyro6OinpyZlJOOjImHhYJ/e3h3c3FtbGpmYmFdXVtUVE9QTUtGRUJAQDw7OjY1MzEwKyopKSYlIyEgHBwd",
	"GRkZFRcVFBIQDg4OCwsJCgcJBwcHBgUEBQQFAgIDCOHj5Obn5+fn5+fp6enp6urs6+3t7Ozv7+7u7+/w8PDz8/T29vb29vb29vb2",
	"9fX3+fn6/Pz8/Pz8/Pz+/f79///////////9/Pz9+/r5+Pj49/j19fb29vb39fX19vb08/Hw8PHu7u7u7ezp6erq5+no6Obm5+fl",
	"5ebm4+Tk5OPjd3dYh4d3d0lndoaGd5hpmXdoaGloiIqIeXWIp4uXuWpoi6ZnlYSGVrh3ial5lXhqiJmcp4dnyrtpeIl8qXmYWXt3",
	"e6uoaHmZibi7mKiFqaqomouHiJh5eXaHWHl2lHiKVpiXeYmIaXiHZ4eoiGZ3lniGlWVomId5eIiXiXd1d2aXl1h4aHV3aXd2iIh3",
	"Z3apZniWeFmYeYeIdneHZ5ipVmiIpmZ3dmV4lreWh2SEV4d1uWiFZXaJqUJ2qYqnV3Zod1c3i4d2Z0ZnuLloZ2WYiZp4eneHiGeH",
	"iGV3iIhniZpXuKh4uXmKd4dmWaiIZoepWYWFZYiYh5l6iHeHl3Z3aGWHd4dod3lJd3d4iZdnmaloeHl2WXp5eGloeJloh4t2ZXin",
	"d4aVVlenuYeHZ4SHamaqi6SGY6mYRpe2d5lGZWl4ZXibxmaohWi6x4dapIVpiYo5d2irimd3dYhoiFaHi0mXtnaIeYlnhnZqeHaG",
	"hrhZhYdlaIdnmXtod4l3dndomJdYiIdleXp3dXZod2dYmWZ3Z4ZWiHd3h2eHlleZl2iHl4dWZYZYRol1tqVjVXdlVKVllmRVt6ol",
	"ZZZZdEIzF3RDJqeGM4ZEKZiUVUhSc4iWhyiWRmpoVWZkeHd2c3iHOKa3doVmemd1V2qXdnV2mHeEh2WIl3d5i4h3dnZ2d2iVl3d3",
	"aHd5eoeFdol2V4iJaHd4WGdmd3dGZWh3VlZ3ZmiGhEZ2hUNIeJeVhVd0aWZVhFV2RWSXiBJUY0VWUiM2dTQmmWIjJmVolnSUZ1RT",
	"Z1hWVmZUaHZlVlV4aIZGiHlYiZh3lmdZh3hXZ4Z4ZnaoV3eHZ2qXWIp4iIhoZ2V3aHV3h4eHdXl5d3h4iHZ5iKloV3VYWXl5d2V1",
	"Z4dGhnk5VYaGRmaFRHZ4ZZaIU3SYZEWGVXZFJJdoJHSFJXRUYxZzNiZ5VlV2YkiGeXdnZGNndlVZVldWdmVWV3hmZXWHeGW5p3eW",
	"Vnl3eHdZh3dlhohYdIZnapdYiIhodYiHZXhol6dod4d1eXmHhniIdXlmiGZ3ZYhZZnl3ZneIh1l5m1l1h4doc4dmRphnlZhXdWlp",
	"WKZmZkNml7lCVqZJhlhUaHdFSIqJeFZGepl5eGdjl5eYiEmVdIpWWHd2mGqIRIh6WIiXh5hmand1d2iHd4Z0qHl1hmdol3iKeGiF",
	"lpdld2iXl2d4h2V5SYd2eKZ2iIiGZnhneFdpeXdYd5iHV3aYWXiJdEaGhUeGmJWIpmSXd2lGeHZTNYaomGV0pmaFWlZod2Voiolo",
	"VmVYp7l4SaWWenh2eFZ5i1lmdXV4d4h0Z1p4iKmJtoZ4hXV3iJh4dnSoeHWGZ2iXWIqLaHiWh4V3Z3eXZmZodXd6Z3Z4iJd4aIh3",
	"Z3aJaViIiFZ1ioZFqol4ZnmoZnaFdWeIZ6iXdZVpSWW5VoeFZLmYRnWmZ4VmdkZ1hoeqhph3k3mnm6polniYmHmKZniIh4dnl3do",
	"iWR5eWanpoeHhmiGiIhXeHaGdqhmZYRnaJd4iIl5d4iHZ3hol5dmaYdnd3lnhnaJp3ZoiXeHZohpZ4iIV4hphkV6qUeHeaZWdoVl",
	"l4iHqJh3dXmZd5VIZ4VlmZlXdWR3hZhnR3aIN4qJl3lzWpm5qFiXiqmYiFpmaImKh2aIl4iIRpmYiJmXiKeJeZaGaIiHeGZ0qIZl",
	"hGeIh3iKi3eWiGdliGiHd2aJiHd5SYh2dVaHeGiIeWeIZWmJeXhmZYqHVpeXaWVolniUdFd4h6aXh2SEZVeFdmhIZEZ3mXdzhXhl",
	"e3ZXd2Y3aJx2VXJYp5mHWZSIuldpWYZWSHiGdVdnV3iEiGlFtoZ3mIdoeIZXeaiGZnZ3VmaEZ2eXeIiLeJZ4h4WHaIeXZmmHdXlK",
	"Z4Z1eIdmaIV3Z2hoZpl5d2Z1epdYmYhmhniUdmR4RkZ2eIdZZHdXioV6amZ3RHepVXV5aGN4hld5WBeIp6p3d2ammYeFhIiaV2dW",
	"loZIWFZ0RYdZWGWIaUeGloe4ioiHhndaqGeIhndoZZZnZ3dYiGl5l3aVZYdIl4dmaWh3d0mHeHd2mIdYl4iIZmdnhneHh3aZl1aF",
	"qEd1aJhndXh1Zoi3h5iHdJdaeJV3RYVVeIqHc5ZpZXt3SHd5aLmYl0hYSKmohpiEhqmXaolkRHiIeHZop0dodYZ5ZYind6eZeWeI",
	"ZziYeGZ0lmd1hmdWhniImol3dnd1l2d3l2mIaHd5eWd1dniYh2mId4h3aFeIemhod6iWaYepeomapXiUeFhmeLeXeph4aHd4eIeo",
	"iFSIqmh2l5t3eJd5d4d4eciXaHZqqKaFmrVoqrdnaWV2eol5pmend4l0V1tluIZnh5h5h4VXaHiGaHeZd3SFeFiGWIh5iZaIh3Z3",
	"Z5d3aIh3d3dKh5V3d4iHiJdmiGZ4aIZ3l2iIl6lYmKlZh5aWaVd1dnV5uKendWVUeXeHfJmERIebc3WKmXNmh0h3i2qomZhHiYmX",
	"l1eMxJiqiXk6pDR6eXh5hnlWeHV3iGd2x3h4eVmHiFdqZ3aIh7dYdYZ3SIZYiHmJd2eFhndnlZeGiGd3eXlnd3ZniKeJmGdoeGhp",
	"endoanV311h6iXZml5lnZ3VpZ3m4iad1h4d7h2d6mbZImZlXd4q5c1qnR3uLaqi5iXh6hri3h4mkmJqpeXiGNXp6d5ZWSYd4RXho",
	"hLaXeIh5Z4eIZ1pnZoiHd1iFpXd4hliKeml2eId3d2eXd2aJdnVoeGd1d3dnqXmZZ1dmd3Zmd5d2hZiGh5mHV2h3Z2ZkdHeEZ3Zz",
	"iGNFhGpoZlqHp3WFVTFleJdRSGdWeWg3iJhmR1hVdLY2iaJ2eWhpaZVEZlh4dnVHdodkmGlYiYd2d3dnhXhoiKdXeHZ2SGaod4eX",
	"iop5iZhneHaHZoeXhpZXdWZ4Z3d2lXinZ5d3eIZoeIp6iFd1mphomZhYeIZ2d5d3WFeGl7aahodoh3h3V3iWZqp4RXWZWGJVWCd6",
	"eUh5mXdYSWaJx0ecxIWpqno4dmZ3aIaHdYhXmIV5eHWatmaHeVmGeGh4h2eYiJdIaIZ3h3dYinqImIeWdYdmh3eGaHdnaHtneId3",
	"eWlnqWh3eHZWdmeHemWYiGeWm3mIiIZIVoh1Vnend4d4VIaYVIh2VpdkqGlVVnhIVVVWV3l3WHeXeWZpV5h0hpizNYhmaSpld2aH",
	"eHhlWXqKhGhodIm3V4d5aFV2h3iHZoV2mWhodWZ1d1iKmYh3Z3Z2h2iHl2iId2doWIeVd3d3mWapaGd4aGl2Z4hpeJqnVol3dmZ2",
	"h4iGiHZGl8eXiWVUWHZUmHl4h2aomVNUephyVVZHdotZWZd3Nll3lYhGmpNjiGloKnSTZml2eGZ3eIqEaGpkuYdWqHdZlXiHeJh2",
	"hXaXS4aWVleXWoh5iIdndnSHSHWXd5dWZXl6Z5WHdoeHdqdXZ3iGWXd6iImXeJZalohmaImVZ3aUiViIx4aJhHZqp5mHm6eYR7nH",
	"RZeai3SLeHh5iFmaq6eIWqmXp2ippHaqh5l5lod4l4hohYuLh4aIWlV2hoiXd2hndmhXeIeHdZlZh6Z3h5daiouIaIeHlYdlZ6dn",
	"d3Znd3pndYaFh3dpqVdndldneXuIiYialmepmFd1iKhXiJiIh4aJubt0eaemdoerapunmbszd3aalnmIeXeaeZyrl4iKiYbXiKmi",
	"dqqne5tnh5t6qIqGaIhnhohoWLeWl5eYaHeGiGeIZ4hzmViHpXZZl1iKe4hmh4dlh2hnh3dndmd5SmeVhoiHmHmZd4dkeGmHaXeJ",
	"dYmFZ4ZnWHd5h4ZnhWZGaIWYp2JXdlWUh4pWd3eKxjZkd2p1WHdVeWiIaGZmZ1VYmIRWjJNyt4Z4WZWIiVp2hHd3aFZmhkl3eXV2",
	"iJZYZ3dXd3hmdXV5eHd1Z3eXiop6h4eHhWWGSIeYV3dXZXl6Z5iIdoeWdsd3Z2dmaYlpdnmHhohniHeGZXaIWGejZEaVhZqJU1VW",
	"WZeHd4h4hbqZFkZmmHFHlyV1ZoqYeDVoRliZhGaKlYeXhnhadWZmeJZkd1dnWGRpWHd2p3imh4h1dVdHeEZ1d5dZh5RWV3daioqH",
	"VWeIZ4dIh4ZoiHdnh2uHiHd3dZV5mVh3dWdpmXqYiXV5lniZmEh4mbZql3RYVoiXqZd0Z4d6had7WYhlqdw1ZpmbhmqIVXV3mXmY",
	"mYp2d4XHZ5fDmJqJiFyYh4p4h4qFd3hpZIh5WMe3Znh5WIaHV2eodXd2qEiGlWRniIiIinhmdodliEh3hmiIdleJa3d4dZWXZ3mW",
	"iHdVd1d5d5iJdHmGV5aqSGiJuWh2lWd4iIeop3WFd3enl3iZiGeZnIiGuLmFaIhVeWdpiZiZiodnhsZneaSmuohpicqnd3mIiKeX",
	"h2hliHhliZRWiJd2hYdnV6h3d3aoS2Z4ZYiIWIiKaGZ4h4WIZoeGaYhXZXdZiIZ3eJloeZhoh4VpZ4l6h4d4l4ZqmZl6eYp3Z4SU",
	"R5WYuJmGdVd1aYaomoiHd5nIVXeYqXiJdyZ7iYq7yYuZZ2mWmWdotaaKunhbiHmpiat2d5doeJZ3ild4t5iWeUiHhodZqFZ2dqh4",
	"hpRkiKiKiopmZnaIhYlod4ZpiGdliWmIhnd1dWh5lmaYhmlpiXqoeXaZiHqWmXd5iHZHZ5dXZ5iGmYh1hGVnh5iLmIeHmpuFd5qJ",
	"eHqXJ3eJhrmXe5qXi6q2V6qVmKqaeIiJdYdpqFZ5d2d5dneJhba3aJaXR4eGV3eodIaGiEhmdGWIiIqKaHeGdmdlh2Znh3d6aFdo",
	"aGeYd5h3aFmJZleIdmmHd6dmdpmGd5mbR3aJpUdnpWdnmLeXpYeFZmd2qZpmhmWYiVmEiVdoi2VleWpHeJVYaGqWp7l3a4WZmqhn",
	"e7mXenmKZYVlNpZWaJhEubmYl6hYdndnWndnWIbId3VkZYmXWnqKd4Z2h3aGd2WXd3pmdmhYh3h3eHdoaIlmeGh4Z3h4h3Z4msh4",
	"mXtnZpmmZ5V3h2eYh5alhVZUh4iHeGZ2M6iMtYSGV1eIZmV1Z0pnmliLimaZtHZphKiKiGc7uHl3eIdlp4Y4Zld4aHS5iHeZZ1h2",
	"iFd4lkaGhqh3dZRlWZdaiIh3ZnimhYd3h4dXd2ZWeGhneHWYeZVomWh4aGZZiXqIeXaKmGipu3mHmXhnp4dZmbiJqZWIhmiJiYl4",
	"l4hnyq6plKl7eHiHZ3aZermIiKudeae3d2mlpauqiHu6eXp5qIemaHh5ZniHWLm3mLeYaIeIV1l3dmZ2iEdVlGVZd1qKinZmeId1",
	"h2Vnd3d3aHNnWoeVdZeXaGaHeUhmaFmYZpdpZZeHZ4anZnZ4l0dWlGdVaseYlmZYaHpmZ1U3hGaXe5Z0dkVFZkRFeUl4RnVWSXs1",
	"drmHiIKmeapGOZh3aHqWSGZYmHhXh3hHmIiJhod3dYZ2R5dXiIaXN1VmZYmXWod6Z2h3pnWHR4eHeIdnZGZJh5V1mIiYiYdHaIhV",
	"Z3Z5eIh3mJh4dqg5iImEdoWEZmV5lmd1Y3V3h3dnZ2dWdZeLZZR3V1iJhVV5eXmoZmV5eUWHmadppZaJZlk7p2VqeZhXdld3eGV4",
	"V2Slh3mLmEeFhnY4mFZmmKc6dXV2WXdaiXpmdnmmdIhnhZdoimaEaDlXeHd1hniJqUl3hnhXdmh4WWeXlWiFrDaHeIVIdIZZZXin",
	"Z1VYZFh5ZnZJZEUiWJpVdFhIQ3hVNXh4Z3dVRlh2ZHaml3xjVmZYhUlnZWlLhldkRnh4lodYZGWkZ4lWeGd3h3eYWIZnhzd1dVaJ",
	"d1d4Wmh3eXaWh2dnl2iKd2ZoOHaHZ5V4iYmpd2d3ZGeGepd2RmaGZ4mYWIZ5h2Vkc1hmZ5iDNlWFSGVXl1R0UUVVZzVkeFRDVVIm",
	"dkdHZmckNkZnd6Z3WoJ0hnZVGVZ0SDp2ZmM5VodnhmdTpWd3mIdmdGiGSHZGdXSHZ3WnVodmR3daWHVnpnSId2eHd4hXVGZpdodl",
	"mHaXiKlFd3dkR3l6d1ZUZ4ZniXlYh3h0RWRyaEaVtoVWWIVWZVW5VDQxQZWLZWR2JEZZMiR2RkVGQ1Q2RmWFxnd3U3WGdlVphlQ1",
	"WndGZEZnh1VmR3WlpnZ4hmZ2Z4Z3hWZ3c4hnd3VWiYZHeXhol3emdIZneId4eHdmd2d2d2d1hoeIp3VmV3eHl5qIVnVod1aFmkdV",
	"dndFdHJYRniHlEVndVVlZpdoNVMzVGhzZIVIU2ZTBXZnN2hFFDRGaHamd1qjcnSFRSt3d2ZaaGVWd4eGWHVnRHd1ZnhoN3V2V3h2",
	"RXdkh1hldXaJlXl5eniIeGeVh2iHl2iIeWZXSXZ1ZZd2h4inV4ZVdWmZaZh3Z4d3eHiHZmZ3d0dzhVdGZYd1RVVzdlVWZ2dlViNm",
	"lnRmdlhWaTNEeVgXiEZSNmhohpeneHKVdUVoaqaXaTqWhHVHV4lndzZ3t3WHd3ZHdnhnV4VnVXaHWGandmllSXl6eWZ2hYWHdZeH",
	"aIp3ZFdpZ3VnmHaHiKlFd4VXWYl4iHZ1mIdodnp5dom0d2dzaFh4p5dHZXd1ZVeZd3diZYmaRGRmVWSJVFd5eTqoRVc2RWmZp2d3",
	"pXR4Z3hLiHV5OmZnVndWaZaXNne2d1h3l3d3d1d4d2Z4dod4hXVWiWV3d3l4hniFhYhnh4eHh3dnd2l2dWWVeImIqVV3h3dZd3h3",
	"Z3Rnd1mVmndViYZHd3JYc5iHl1Rnc3VoVGl4d1M1h7o2ZFeWY2lUR3p5OWp1JFZGaJbJd3elVHeFdjt4dXlXVmWHR4eIlndXdLam",
	"aJd4d3WHh3eJRVaEd1lVd1ZplUd3amhmdoVliGd3h2iId2SGaXaHZXeGdneWaHd0Z2iJeJeGZYeGSal6dniJmEZ0dFhWlYamh1d3",
	"d2VGmVlndGSolzRkVElmZmZWeXVZmXUjNmZYiXZnaYV0d5d4SaaFeGdnVld3SIaWd1Y2hodoeWd2VXV3eZdmdnW5WlWlVleGR3dq",
	"d2Z2d4aIZ5eXZohXh2hpVmdlmIh5d7loeHd3Z3Z3l2lliYVll3dJdYmUdndzWFiYlqhlZ3V3ZTa3aWl2RIiYM2R4RVRlhVZ5eVmo",
	"dVc2NFiGppeHxZRnR3d6d2WXZ2ZWVndHaWZ3ZzaIt3d4eVd3dVdZl1d2dqhWVXd2iWZHeXpZhniHdodnV4dmhndmaGlWZGd1hnZ3",
	"mWZ3Z3dZiXi3h2RqiFl3mEl1iZWImHNGZoqGdoeFdUdFZJdph4RkiMg3ZnR5dnmYV3uaWZeaWGd3WKl4d2qWl7iVaEqnhXiLh3WV",
	"Z1mJZ5eJOIiEZoinV3d3l3d3RIeEqXhmd3ZXZkl3d3dmdnd3h2dXd4aYV2doWXaHZZiGeXmWaHhndUh5ereHZ4eGZqd7d2irhYiV",
	"dohYiIimuYV3d2tomWqHh3iImzR0d3aUd4hZdpyraXWEZ3a4p6h6h6fXmEh7Wpdle42Xd5eZWGlmd1k4ybZXqKl3h3V3e6dnhnaW",
	"eWV1domGeXdqiWZ4p3WHR3eGV4hXZ3hYZVh3mHZ3abdod3dIWYaIt2lol5ZZqHl5iaylZqmUZYeo2LrJh6hViZh3aoeZhdnZZHl2",
	"iYmJmFl5rJ2JaWqaV5y3m6p4+aiYiLuLqoeJq6d5iJpniZeniYaXlleZumeHhpdaiHVmdqh5dXVWWXeYaHqGhniHdoholYaHiFdk",
	"eFplWXeYeHl5l2aHZ0hpmoqIaHiamGm6iZt5qpmJqqZ1ibjYuKl4pVVuqah6pZaH2ayZd5mHp4l4iHuszaqWeZuZubjaqnn5yrmW",
	"qnurhY3Nq3l4mpiJZmmJVqemV4yYZ4WGh1q4d2aHuHp0p1aHd3lnWFhodqd2hmZ3hneIWYR4WGd1Z5h4iXe5SHh1hmd5iIiYZ4qH",
	"RZqJimh5lVmGhVeImbmH2pWYWn2Xl3hnhXSqjVV1dXd3m2Y5fIp7ipeXWIi8psi6a5W3yKipiqh2fr+2hmmpeWVVeEdXybiGiIl5",
	"hYeHeYd3iHeoeoV1VoeGeYd4aJZ4h3aHZmeGV4h1Z3ZIZ3WGZGV3Z3d3WGV2V4Z3d1dUZodJpqt5Zoh4eJiGV3WIp4ish3NGWImY",
	"i3h4hqiZU1JjaHZmlFd1aVmod5dWZZiEpZhchrmoaIh7t4ZqmoV1lliaSGWHZzaGmHWIiVdkhnd3d2Zmd6ZYdZVlSIZoiHhoZniH",
	"dYdoZYZniHd0d0dYZ3eVh3dnl0iHZlZXaHl3iER3lmZ3eWp4h4dnZZZYdneWubiZhkdnhqeHd6aWl4pXdXSolHeXd3uLi3mZZ1dH",
	"mIS4iHiYmZpnaEvHZ4mciVN3eVloZYhZV7aYd5mKd3R3Z3l3d2Z2mHp0ZUVYl2l3eHh3eHZ0p2Z3hniHZmd5aXaWd5iHaGiZaXdo",
	"VmmZeadoU4qHRqi5inmJdVZkdXiIZ7i4q4RjNmeGp3qWhVR3eFRlZmd2d2ZGemlZuZqIVniHc6eWaYfKmZiISrh2eZqlVGdod1VV",
	"aFp0tphmmKlnZYRXV6h2hnaod2OWZWh3aXdqeHd4dpV4Zpd2d4iGdXdnVod1mJdmWJhYZldFVoh5d4hmdodJeah1iHh3d2ZkV0eG",
	"p2m6hWMzh4iFSkZ2ZnmKUlI0aGZpZmZ2eFmZmEdGZ1ZlhoVZdKWod3pZl2aLjZh2Vlc2Z0VXemWmt3aZiUd3iFdYd2V1ZYhodmRl",
	"aJd3d3holnd2dYZmd4Z4iId3V2lWh3d3l3hohld3V2VXl3l3WFaHh0V3e0V3eKVXV3RHd4iFqbp1hXWJaIdVRnNGeYo0VUhmZGaG",
	"Znl6WZmYhmZpdIWFRFd2hKh3RymnqIiNmFZllTZmRHd5RqmHWJh5Z3d3V3pnRnVliUZ3lEdXd3mXeohneHiUh2iHhoaIaIV2SFaG",
	"dViXeGiYZnV3VFlneohndZeWZ5l3eVaIdVljhHWIl8eIuIWDh2l0lmpmdHWKqUR3Rnh1endkdnpZeYmWV0VKdpdkWLRjd1ZHWXdl",
	"WIiHZaaXh1Z1mFlUqHR4iIZYZnhXaXhGdXd2SHZ3Z3d3WIl6aJR4d3R3Z4eGaWhmdnd4Vmd3l4d4Wbd3d3dWWYh6h4p2epZ4Z5t2",
	"doiFVWaDWliJh6qIhYeGeWSWZnZ1hIipR3VWeoV3dyR5eFl5imZHdZp1t0hohZN6VUhZdoWpiYplpWd3WWR4aHR2dnWIlniWdFeI",
	"dkdVdpdGVnVmV5d6iXhohHaGhndnh4ZpiGhWdkpWZnWVl2Zoh2Z3d2ZnmXqnZ4iHmHhmmHl1iKhHdZaYiJrJmIh1Y5VpeJhomHd1",
	"eolEdVRYqXjHR3mYhom8l3iHl5Xnpo12lnlpiCp3ZFmLiIeHd1d2dnhpV3h4WKm3WFZ5l4l2Roh2t3p3lWZ1d1iJemhmeIdUd2eH",
	"hmmGZnWIWHaGd5eHmFinZ3eHZmd4e5dniJiYWGeYeXWIdXd2lJt4l8nFuIhUdml3qGuah6eKjVRXVlykeJdHdnxmirlneId3lblm",
	"iLV2iYmIemeIioiIh4aXiHhFaFhXuHV3qYd4ZHeHiZdlZXZ3V3R1Z4eXWIiKiJR2h1Z3Z2eGiIp3ZHdJdoZ1d3eYaIhXd3VYaIaK",
	"iIuImodqhnh5VYiHZ2aUaWeZmZdoeIVlW3jIZph3ZoqtVYZ5WqV6l0Z5mKea11mnR2unyZh7hZiamKlKmIVYeIZ2eFh4ZYRoZ1fI",
	"h3ipiml1p3hZdzV1dqhXd5dkh5dYiXhodnmmdYd3iJd3iFVkWUd2hndYZ3doh1eHhlVnd4qIi4WaiWqGeEdWiHdnhZaJl6mZqqiF",
	"dWhbh8pomnSWma1mhoWMpXi3lnmIqauqeYd3iabFaXuFmKx3eHqYiIl6Z3l1aHdohWdIZcmmeJmJiXaIiFh3dmV2iWd1p2Z3d3iI",
	"iGh3d3dlh2eHl2h4d2d1SVaWd3WVeGiISHdXZld5d3dZdGl2VXaqaHR3dlZyhVeImLipV3dHZ3h3uYdndoSoqUZ2qVeFmHdGdWZI",
	"qJhZh3SnqYh5i7WouaeYa7ZUeIuaiGVXV3ZWl3Z0d7ZXmHlYVHVneIZ1ZnaIV3WEZ3mXWImKiHeJh3WHZ2d3Z4h3ZHlqdmZ3dWd4",
	"aIdXd1dYRnd5d2d4h6d3h5tHeIiUZ2aWeFiIiIZkdEWXaHe2ZpiGZ7m8WIeFaZiLqFh2iVx6qaeYVrq4mLmblqa5q4qMtlRri5iI",
	"aKh3hWeKaFiHxpmpuohWdWc4d3V4dqg3dZRmd5dYiXhol4iHdYdoWIdXl2d0d2l3lXV1Z2h3l3d3aFdId3l3VnSYhXiVl0Z1Z3dF",
	"cnV4aLiIlKV3eGhliYZ3hoRouJiIg4l3h2p4Z3lYSWiZVoiIWJjaeIu1qKdoiWh3Z6qLqIiHd3d2RpdZR3e3d5pmWGd1d1iXVYZ2",
	"dmh0lGZ3l3d5eoeXiIZ2h2d3h1l6h3d3aWd3dVhnlnd3ZndWdVhpeXd2eIqYioaIeIh4dWR2hohoiIindodFaGqGh5eWmXe4uXmX",
	"uJyUqYlndWpYual3uGa8qevJmcXGqKiLWHdkiIiHaHiHiIhUaIdnh4aIqIdndXV3WHdVZ3eXaneVZ4d3aXl3eZdnp3aHaJeHdXdo",
	"dXdKZ3V3V3dod5ZoV3hnVml5d3d1mIdpiZtJh3p1d5d1dleHd3enc3dod3V3eIdldXd6RXJ3l3R3l3d5eFd5i3d3R3eHxnd5dHWX",
	"V3hal3R3end0dXdGdnd3h0a2dmiXqHdldXd4d1Z3dpdndZdnV5dpd3pXdnmGdYhnd3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3",
	"d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3",
	"d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3eHlll3V2R2aVd2d5eHaGmZZnd3VEh3eZd3dGiWaJmXeXd6lGdldWl3eXd1iXRGZ0Z2",
	"eXeHhVV4inR1ZWiFd2d3dnhomZl5eIWXdahleIWXiHh5OnZnenpYd3Z2R3lFlnlUeLVGiGZIZHVXeXl1VnZ5WnSUZFd3d3d6aHZo",
	"p3V3SIeGV3p3ZHlpZ5d3dWeZZ5l4d4dlR2Z5d1Z0Zph4lXdGhXeHd3V1R3enp6ind3NUanWkeWeIZ4i8VXWZiIV3d3d2eIiJt3lI",
	"RZqVpoZ4hZeIlnc6hpR6epd1dld3eXRnele4uIWoiHiEeHdHh3V2dpdqdYVneZdnd3hoZ3l3dXdmh4Z3d2dkWWdXeHeYh3ZnmGZ3",
	"ZWhFh3d3V3eGmGaVd2eHZ3RHcndXRaeniKVjdmSaead3h4WEeYpVd3ZmdHpnd3Z4iHeHaHhFd5mmlXeil4Z2Njp2ZHp3V5WFV0Z4",
	"RWZ5d7aIRYiHSGZ1d0iXNnV2tlp0lGeHd2l3emaXaHeGd2aHhnd3V2Z3aVd2d1WHdme2ZldWaEVneXdXdImWaJV7RoZ3hGdldUNF",
	"h3eFdWWDV2Z5p5lnhYV2ikVVdmd3eXd3dnpImIWIeId3lciWeqK1hTaJeIVnendYlVZ3SHh0ZnlWdriGiIZ4ZHd3WHdFdnaXZ3WF",
	"Z1mXd3l6aGd5pnV4SIeXd4hnd3dJdmZ1d3d4aIVnd1dYVodmh1d3iJZpdXt5VmiHZ2WHRmaIp1V2ZXZXZniJl4eoVme6NmV1V3R7",
	"l0d2aFl3hWZ4ZpqVppd6k4Wnhzlqp3d3d2l3RJhGl1VneUR2t2iXeHhWdXdIpzZldnc3dXVmd5doiGdXd3endYhmhXdneGh3iWl2",
	"l3d4Z5iIiGd3h1hWeWqXd3R5lml5l0mGaHRnVYVVVJinZXhlg1dKdYR5Z3ZUl7ozZXVEd3iHR3VpWXeJRphVmpimeHZ1aHZFdWin",
	"lHp3d1dHeEh5hGd5dHa3ZpdoSJR1d3enVXd3l2l1lGZ3l2iIl3d2d4d2hmiHl2iIaFV5aXaXd3h3aIaHZneHWFaIZ3dneJmniqqs",
	"eHd3mHZndElHqYaWZ3RkZ6uFiJumh4OFnEWHZGaEa6mXd4dKmZhIaHhqmJmYmnO0uHZlOIiDmGtXRVaJdmiWdWdkuZWJqLlYZHVX",
	"V3c3VnZ2Z3V3ZoeXaodnV3aIh3WHZod3d3p3dXlodod3lZdoaId2d1dmaYp7qGeFd4mKiIiHV3eoRnR0ali6x6eah2iIvJeonIeI",
	"hLaZaJi1d4d8uqh4mlusu1l5iVqopWiacsipSXaKuXZ6eZl2dmlXaGV4WWSHlYiop4l3hoiJd3d1dpY3dXRneZeJZ2l3l4mHhYdm",
	"h4dniHeGd2lWhnd4d2dYmVl3aHVniHuIh2ZomGmpd0mFerdnY3V4l6qomIqIhIp6dJWMtpQ2uaiHmHhpY3yaqHycia2JW5mIfKaH",
	"Z5yEhtl2Vnm5hVqIiIWGeFd4dHd5V3qJWImYiJeHZ1mXZnZ2lnp3lGaJl3d3eldneWeFh2eHh3eId2Z3SVaHd1dneIiZV3dnd0ZY",
	"Zpd3VmaYaYWKeXd3h2djcldWqZV3pWRTdWuGiHqYiDOHyDaFhmZSaXmXd4domHVaaIhrmKdYmLR0mmVoaqh0eVeXdHV4h3Zld4l2",
	"eomWqZqHhHhGSXlnV3O2SHV0Zol3Z3l3d3dWh2WHZ4eHd3h3Z3dJVmd3d3dnebl1aHh4V2l4qFl2ZpZmeYd2h4iVdoeDeGeXuLm4",
	"mWhXjZdmmpeGNpipVqd4tnNYioh7q2rbineJaneWuHeJxJWoZ4hayWipa4eFh2hnaYWJWFd2hmWJllhndldnp3eJh5d3hnVmiZdp",
	"mXpXdoaIZYdol4dnh1dkV0dYhndYZ2d4mFh3eIZ3aXqnaGSJlmmarFiIeIhYhZZ2errJqamWZHeYlreJqJZHybpFlImZhIyIVnqc",
	"m8vYeJqWi6aZeJyGqKq3iFzIc4l6mZaXqJiJhohpaMeIl4iGWJWEZ3mHd2aGiFdUdWZXl2d3anl3eIeXiGeXh3iIZ3VoWWd3d3iX",
	"l5mYd2dmaFlnd6doZnmYeqabR3iZhmmIg3mZeImImpaGqYuIeIt7p3Pb2Whmmdp5mJmYfJpqy77MapecyaiZicbIeXaqe7lmZoqp",
	"eYqHmIaWiYd3t4aImZmIlXiHZ4d4hnaIeIiVZXmXZ3l4iGh4h4R3Z4iHd4h3dGlpZ3d1eIh3eZl3Z2h2Vnl3qJpoeah3ZotJeaq2",
	"aaiWnKqJmJnamqq6mKmIi3q6d6vrmZZ9m4ipqmh7rpuszcyreMu4uqqaxrjZy5tsuYNnm7uKmIiIiZh6WYS6h4iZmYl2dFd3p1hm",
	"hqhbhad2hZdnmXpoZniHdKdnh4dniHhkhjl3dXV3iId5mXdnaGhZZ3doeHRpqFdpe2loqJZ3eIZ5eImYmbiZeGmYmZiKeqh0ubpJ",
	"mGqbhouJhneZqZvKd4h4i5jaqZmWlrqJmGuIhop5qoeYWGmJZpdYV7fIiLeZiXd3h2qHdYh2iFiFp1ZZl2p3eGiGdoeGd2eXl4iK",
	"ZndmaWeVdXeIeXeWeYeIiGdneoZ4dYmmaJZ6d2iIhmmFhnl4iZiJmIqnd5youIp4mIWYikR0epuFicqneauJm8p3qmqpl7mpmcaY",
	"iomZa4hmanmJV4eIaomWeJhXdohol3dppYhXeahWiIaIeIV3dnWXZ3l7iGZ4d3R3Z4eHaIaHd3hpdmZ3eXh3iJd3d4aIWIaKuYl3",
	"hod2p6iKh5mGiZeWdmeXmYqLhVloioWoeoeql7mKWIZ6eZabqFh1iXrd+ZiJlqqoqLdq19m9nKdIiHR5e3h2iJl4l4eIeXWaiYi3",
	"p4lnhmiIiHhmdqhYhaVWaXd5d3poZnZnZXdnl5doaGd3eWh2Z3Z3aImJmWh3Z4Z2aXinanVnhWiGm3lml3hYVod5iZd2qVZ1l4l3",
	"Y4dlV8dUqHlBU2iZmWaGN3ZamHvHdZhpaZeXeImGxqrJm3p2Y2eKeHaGZ4iKVmhaVLiViJeYWXdld0l5eIZ2qHiGdVZld2d3WGaW",
	"dodld2eHh4aWZ3WJaXZlZ3h2h4mpaFeFV1mWe5hoaJqYeKaMa5qohkl1p3moeJiXuJp5qVl2eGyryWaZ3miGurmWqHhXeYu6rMt2",
	"q5yZy9fMibeorKuZbJiFeYqJh2mHeXdnl3qIual5qLl5Z3aIiadohnaIeneldnaIV3lYiGhYaGV3Z2eXZoaIdXhpdoWIlniHiKlm",
	"d4VnaHaId3dol5h3iYxol3iWd4WFiqiImMe4mnasaHV4eKnJaImMZYWcu6iqqHd5jbys7ViLmZnLu5x4mIqJy32cmId4iqqpeXdp",
	"d1aZiompiYeoeXhliGhZqIdodqhZdHVWdqiJd4hIiHiHZXdnd4eHiHdmiUlWh2d1h3ZpqWZ3dUZIiXpnaWSJl4qZu0lYeoV4dIZp",
	"iJepl3eHWHdahpdnmrpUqJtyU3h7iZdmN3Z6WbvahWhHi5jJeHenubmJV3uIpmmLmWaIVVl5ZpdHdLiGaJiGWHV4h3eFVIZ2dnZl",
	"hXWHhniJe2iHZ3d1d2eXh3d3eWR5aXZkZZiIdme3aHd1Rkl5eoiJZXaZaYW4SXd4iFh0hnaGl4mXp5WIeEdkaWdWmFaoyDeCaHal",
	"d2Z3eXiZm7xnaIaHmKdoeqW5mYZnO4iGZ4mXhmVnV5dmd0d0domYmIlohYeHeIdmd3eZWWWmRVmGWHlaaIdph3Z3Z3eXZ4h3h3hp",
	"VmdnlYh2Z6lmeHdHiHd6p2llaZd3dnt5ZHWIVnSGhnWXp5VZeHaXRFRnZTaYWIioRVV3eJd3Rjd5eJh5loVHZGeFd2d6pJeHZmo7",
	"uKZmZ4Zoh4dXeUR3SVR4qImYpUd3dod4hkR2dpl4ZqV1d4ZYiVpoV2mndndld3eHendkeWh2Z2d4h5ZnuWZXdUdoiXeYeGd5qWh5",
	"l3d1eJh2hISGdYenhXeIhZdXVplVdmh2qGhFU3R4hneFV3mHeHq6Y0c2Z5SWV3rDlJY2hjuIhGZrhmVkiId3Q3d5dHa4aHiHV3d0",
	"V1l2Zkd3l1llh3WHhliIeGh1aYd1d2dnlmd3d3d4SVaEZZiImYioVYhndUZXeJeKdpeYaHeoeHZVmGd3dkdFZmeVU3d0V2VVWGhV",
	"dFW4hzIzRYWFVTVmdFQ3aGZWFkN1h5eGZpNjZXV2aqd1hnlmVmVXZ2ZDeFd3uHRXl2hHhYiHd4llVYaoWGanVomGSXlaaGZ2hWV4",
	"RoeGZ3d3dXdJZoV1eIaWaIVVh3dmaYd3qHiHiKZ4matXh3iYZIWFVVh3iIZniZaoWWaIh3eXZpmoVFV3d5mWlkh4d1iLq3ZnZXqU",
	"yIiLhJR1hodZuIR4i5Zoh2hpiGVZelV4l2aoiWdneIhaqFdVdqhaZaV2WXdZd3poZnaFZXdoh4ZZd2Z1d2h2hXV4hnZoiFZXdGhX",
	"d3iXZ2WIp3iVqGeXiIVnWIdVVqa2hWd5aFiHZmhndGeIh3k1U2d3hXVniHl2eIl3djZXSGWjZWt0dGZWV4mHpJeIdoiGaXhohGlZ",
	"aLiUV4ipaFd2dneIV3V2iHlVdVaJl4d3imiUWIWVd2Znhnd3Z3SISVaFd5iGdmaIVnhkeGeJeGeHdaumaZmod4WIiVWIhXhGh4aJ",
	"hHaYmIlkaodkdYa2p0VTZnaldXdYe3VZqWh4NmdYZYOGa4V0dmaLiHekmIhHh1d5mWdViXpndrdoqXd3Z4h3eadWdVaIWWWndoeX",
	"V3d4ZoZ2h2V2ZmeGeHdXZGdJVmRYmHiHWJhFd2V3Z3Z6Z4h0l4dmlqtZhViFVXR2WGaIdYeXdYRHZlaIWVVUWHiYJVNHZ2ZmJWh5",
	"dCirOGdFVziDhUQnY3GGVXZ6doVXenh0dDZXZ2aGdkZnZnZ3eFh1ZlZ4dmV3ZohnVKZ1WWZ4eXp3d4eHdndoh4ZoeGaGV2lWh1h4",
	"dneImEWHZ1VoeXpoaHZph1eJeEV0eIZXd3ZWOKhlZ3V4hFdmVlZpQ1R4pmUiQTZnaDNFZnZ2KJlFhyVVWHRlNDdidIZ1RliFY1d2",
	"dXd0ZmdmVmhGZmdkZ3dmR3VldnmXZXVmqEdUpVaJhnd4Z1d1Z6d2d0aHhmhnd2R3R1eVaHh4d1imR3ZoiGd5d5d5dpiFZ1aMWHZ3",
	"lkZmZVdnqHRpWHV1pppnh3V0eDe5eUdyhodoeGZIeWhIqFhnR3VHY3dHdqVVaHdraIZ2d2eGZoRHd3dmZ3h2dqVnqHlYdXaGead3",
	"hmSmZ3R3dYmXh4l6eXVnd4V3ZneGaIp3ZHdXh5Volnh5WIhYZ2hoSIl3mId2mYdoaHdohniZSFl0ZmephYWahHZ2Z3VmajiJRnqa",
	"VIRWaHWGR1d2aShohnZYekd1hHdpdbiId5kpqHZ4XJZliFeIeHZ4h1e4lWmIeWh1dUZ6qFZmdYZHVHZWiXeJiXdXh4l3dXZmh4ZX",
	"WHdmd3mHdWh4eHdWhoZYZohZiHiHaGiaqHiZileGiHpZh5R1V3qIh3qFdmmLp6ealnWXqrxpl3mKiI1oaHuJaLuamZp2aYimiGiE",
	"h5hpazh5lYmIiIiWaYiWZnd6dIeEaJmJh1Z4V3qIdoh1l3h0d3Z5l2mIend3Z4eFh2WHhliIV2d3WYd4ZZd2mViJZneHiGh3ipmJ",
	"eHqVZqipdneaiGiZhnd4mGe5mpeUaJyGt3h2eJqsu3qml5iGiLlYeoipiKiKiqh3pqeoeZi4ubmIWbt1mpiHdpZoh4h1V4l3t8WI",
	"mXhoVoiXWqdYaHWZeHR3d1mXiJp6Z1dnh4WHZ4eGWId3Z3d5h5V4dniYaIdoeIVYandoh4d2mJZXl6g5h3ilVnWEZnaVh7mahYdW",
	"fIiJfHZ2dqvLZ6V5mVaGiXl2e1mJh3h3V0elxGdZhJiJWYd5iHaJeHdWdYiJZmZYinR2qGaJmWlkd4dad1ZWd5d3dJdmd3doiopn",
	"hYeIZYhFZ4ZXiFdkV3mHdWV3eJhYmGZ3ZVZ3aHiHaWWalWeHqGd2aIdXh4RYZIhmeIh0dFZZY2l3RmdTioxVk2WEVWt4aHVpSHmJ",
	"Vmd2h5SkVoiEhHeJlymndVhoh2ZliYh4dlZ3dHaEZ7iJV2aIZ3iWeFZnx3d1dGaHl4mZeldVl4dniGeHhmiKZ2eIeGd4dZiZZXnH",
	"WZhldliJeIeah4eYepeMipeplWqGl3h4mJi3q5Z4iIeIt4iZiHh7vpaotnl5vaqXeKmKvLh4q3dsusloibfJepiHacqYV4iZiph5",
	"ipdnmYpFmbaZqJdpd5eHWohXdXape4Z4ZXeXWIqKh4Z3Z2V4aGeGd4pWZYd4h3h3lXeId6lqd2ZpaYd3iZl2ebqKlYxah5ulaJWk",
	"V6iXmKqpmXWYepV3eFmadoj8apWWdnmquah8nbqKuGiKd5nKyniJt6q5uIZ5mbhaiIp5qKp6d4eai3WXuJjIaGhnmWdop4d1dJlL",
	"hnhnWXeKiopnZnaIhXdod4ZoiHdliFhndXd1dWdpmVZ3V3dZiHipeIaKl3aZiIiHmahalZdlppeWuWmWZZd4h3qIh5qmiL6IlZZ2",
	"dHqoiHV4iZm4eYiIeLjHqLmnyYiYaXq6lnhomnmoenl6Z4mKVZe4iKiYeHeXV1mIRld0mHhmdmR3mIqIh2eGd4dld2eHhniKd1Vo",
	"WmeYd3V3l3enVld3dod5eoiHdnqXaZWIh1eZlVeVhFh2p5apa4V1d3eXp4hZmlZ2nJiFtnZ0eohoeGdpeamJh4Z6l6p3ienGeHiJ",
	"W4mWWmiaeWh3aXdkaXpHx7iIqqhYl4hXeqhmdnapeIZ1ZXeXWIp6Z4Z3hYV3aHaGeXdXZYlpZ5h3dXd5d5eHdVZmWHZpqGl4ioV4",
	"p5xoh6qGdlWEeGeZmIi4hYeXi6hoiqmpd3edp3inl4eI2Zh1mIqqyZiohpmmx6maqrZ4uphriHV5eauViJhXeJSXe3jJx5eXqoeG",
	"iXd5iIdldcdIhnZnV5eIiGh3h4dnZXdnhnZpd3d3iGmHeIZ3d3dpqXd3ZohVWIioZ4aph3iqrFeHq7ZoZpRpuZepqrl4hqhYyaZ7",
	"uriEho24icp5lprqVXqtjcu6qJlnirj9m4256Km4e3yJqHqLqZZneXiYeIl5WbmYiJeah4aZaIqIZoh3l3hmhXZ3l1iKi3lmZ4iV",
	"d2iHhld5aHWHW2eVh2Z4iWend4hohmaZe4l4hqqYebipipmKt2iXmGjLl9m8yYqsurq8poqd2neZ3ruZ+sypzsrIfauNrbuYjJms",
	"yfys3/rKy6y7m9upmqurmpiXe5qHmoxnmbiHiJhomJhoirt3hoaXiIameImXWohpeIZ3h5V3aIZ2eXdnZ3lrhXV3lqiJmal4iIdo",
	"Zml4iZp2ipiaiIx3iaq4iIeWeMmJ26mbh5yqrKzGjL2pl6msiJn9rLnMynh+rs7Ny5yMuJrLycu/98fLirqL24aZrruamImqmYea",
	"jGiXqIeoqGmWmZhpuHZmhreLhqZ3h5daiIl3lneHZXdnl5dphmd3aFpnlXd3Zohmh2eIeIaZh4iImoiXqGZ4jHloqKeXl4l3honJ",
	"uZmGl2iImcZ4zNqEhstpiLqrqK2Ltna5e6qtpomKiLrKh72mx5qZi4zJlqqNiXaZi1iZh5qpZLqpl7mpWph3V1modpaHiHhVqHdX",
	"l1iIi1eXaIdlh2aVd2aIV3Voeod1d3h4eIiIaIh3eHeHioiahpmYZ4iKeWaKqWd1hXqIqsmJmYa5eIyblnispneHq4iGqqulrXlm",
	"e6y7qsqoacqNuaiqm8anurmJrMmVio23d3aIWHmHmnuWushnjKdZmHVXWqhWiIeYWoaleHl3iIhrd5doZWWIRneHZmiHd4hYZ3V4",
	"iHh5aIl5iGh3WImZeImYiJmKuapbiZqoeYm3acqa+ZirqrmKjqyoevypqZjedpnbmp27nMt8y73dzYuLqdzc3diep6eqibqd2pmc",
	"jJmbp6lpmLm6i6nJiXipmGmohmhpqImGZqmKZqh4aJd4iot5lnaXlYdmd6dmhmd1aHtnd3d4eIhoh4mIhoZniYhoiYmIqHeXqUeG",
	"iId6hYZod5mImZiImIiLmJdrvapUeKyZl4i5i5l6aXqsm5uqeWmqabe2mIi0h5ipapypo4t4h6eXeFeKqImKaJrGmLmKaYWGV4i4",
	"h3iHmHZlhXiXd3iKmVd3hoWViEiXl2hmaHVoWnhnZ3iYiXmYh4h4aGaZd6hpdYiod7q7ioirqXmYiWloicmJmKmVmpqnmIiKp7WY",
	"y5e5iqp6eoq4d6qLq6i3iZqtuNvHm7WnyrqajJmWiIqoqod6qZl1eohniciJqKh4h3iHaKh2h4ioaXeGd4eXeIiJeXZ3l3aIeJd3",
	"aYlnZ2h7dmZ3eZd3enmHiHiIaYd3qGmYiJZnqIlaqIiJeZiniXaZybm8mJWHaomaibqadYideqeKioV9yoh8qqurnaaKyq23t6mZ",
	"xsnKuWyMmniJi6mIeaqoeXZ6mIWIh4iIiHmGhmeIh4Z2h4dnd6h4h5eIiIl3l4aGhpZod4dmiGhniFp2h2aJmIl3eXiGaXd3aIqI",
	"qmSXl1eYiZuZmZd6ibh4h6qouom7mWqKmMqc2smGusqpyLu7lrnLuXusjJuaqXqpnLm7qJymy6u4fX67h5ucuHiXunmJdquYaImo",
	"mLiJaXeGaHmIZ5Z3qGd3hneKd3iKaXh3h4eWiEV3h4aIiHWIenhnZpiXh2d5eIh2mGmKiIiadJmnWZmMiKmYiHh2tphZp6i4iap5",
	"eIirypzat4bKqqmYq5uXmMu5ea6Mu8qpeqd8uNmnnZbJmoiajpmne3y6dph6i4mliZl2x5iYuJlZmImIWahXiHenanemZ5Z3Wopp",
	"eXaIiJaHZZeHZ4iIdYlpZ3h4iZeIaIl3d2h3Z3mIqImFepZoqJlHqXimeKWXdoiIibhruYV3S4jLeZinlZqpZ3S4eYSKaGl1iGqr",
	"uIZop4upqoV7l7iYqKxqqHSHm4eqWIdnqIeZeVjHuGenl4iFiIhnqGZodbdodHdomHdYiJtZd4eHhYholYdnd3h1iWtndXiJd4eJ",
	"iYd3d3ZoeYqIeIV6l2mZikqqm7dndZdYiJiHuJmYhWlIiKZ5iriImo1kdqt2hIeoaXVom4zYhoh3aKXKppuHuYqIrIh2lmqYioeI",
	"iGeIh5l6hsmHiKeZh3eIiImYeIh1mWh0dWeYl1iKmXeXdoeFqGiXh3h4aGd5aWd1doiXh1iYeHd4VkiHiol4iKqneKmLepiouEiH",
	"mIqJmZiaqKd4p1q5u4usubibmlh2mYiVm3q5d4y8zLyYiWZ5lsmIfLfKqpaqn6eIqWyZmHmYiZloeYhWuoiIp6qYhpaIWKeIl3W5",
	"aoZ1ZpiXiIiLeXeJaIaIZnd3Z4eIZ4lpZ3V2hndniJpod4ZYWIaIaHmGmqZ5map3mKe5eHamh4mmlpu4lpSah7mLi5jHhouYSIZ6",
	"mIaKmnh8jHvKvKeJhYqax5iIt8iaZnyceIipiZmaqGiLmXdpaoaqpoiIqpiIloh6h2aHdZl5WJVomHdYiml3d3eYhoZ4l4doeGd1",
	"eXpndWd4dol3mmd4aHdXeop3aXVol2eGqnpWl5Vnd4NYeKeltpmEhEhpqJlZmJZnmJlnZGa3dIhoWHloSHuGZGZ0eoXKZoinxZil",
	"e3tmZ5yLh4iFiFiJdWlqhXeGh6iZWIhld0mIh3Z0qnd1lVaYl1iKi4h3iHZ1h2h3h3eIZ2d3eXd1Z5d4eHeYR3dpdld3iXdnd4eV",
	"WJaoSHaWeWd4dHiIl6emiXSFRot4Z1qWeHWXiDZkibd0pZhYdWZ4e6loRmZahodGiJfFaKdnm4eHm2iJZXWIV4qGd3mHd7dmh5dY",
	"iHdXiHdWdXapZ3WjVmiXeImLaJZ2dnaIaId3Z3hnZ3dKZ3h3l3ZZiMdoiHaGaIiJuFd1qXh5p5qHipqpeImYaZqoebiomZlWqZd4",
	"abimaJi6aImbuqqompl4h5mtvFiYapmndGh7qKeKim1rqYmdqpiGmKloeGiqimaZx2eJqkh4hodJmpeHh6lrhoZVmKiIiHhodneX",
	"dYZoh5eIiIh3eXpndWeYhYd4qWd3eXhniYqId3WZhniamomHmqZ4eKRpaadnppZ2mFR6d2d5d4VVl3lEdouplpZZd3aKap3HV4d3",
	"e5hoV3qotriZa1p3iK2pm3iXmWd4hXdaece2aYiYh3WGd1mGiId2qXiIhVVmd3iIeIh3h3d2d0iHh2h4aGV5enaUeHiHdomXaHh3",
	"eGlpiIhXdXeGaYibWWd6qGh1p2iIp7e2ZFOUZ1mJh5hFdmaoZ0Z2WLyWhmmZdYpGe7ZmRml7h7hXi5e1iIl3aYl4e3uqd5aIl6g3",
	"mHpnmYaHiYdoeIhXaHdXl3W3aYildpmWeImLeJeJd4Z3Z4d2Z4iHZXl5dmR4iJd2mZdmd4l2eYeJiGd1h3hpqJhmZXilaHipaIZ4",
	"Z5aGY3dEWYiXikV0Y3hpZ4aImnZpmZl6inh7moZnZ3iXhYeLlZWIiEZbl3hpmJp3doiHiHeYWoiXhnmHh3h2hnd5l1aIdXd6hpVW",
	"apZYiml3lneId3dol3d3iIdleWl2l4iIh3iJqWZ4mGhpV4mYd4iYhWmXe2loiHlqdXZol4eneJRndWRoeJZaVqZkR3ZkVGaJhVVX",
	"R3lpN4mHZEeHaZlzeJuYlnl3R3p4aHl5mYh2mFhoZniJV6e3d5h5iXeGZ1mnhmZ2l1mFllZoh4iJiXh3d4h3d2h4l3d3h3d5SnZn",
	"iHaXZoipZnhmaGmJiJZ3VYiGZ6ebZliIhmiIdlVXeKeXdHd1VWh4lnp2hnNXZldVZleHVXY3eWiHiWllZjZpp5ZnapZ2eGpIR5mU",
	"eWtoZWWYh2VleXlmp7aHmHZ5d4aHeYhmZoaXeVZ0dnmnaIhpeJZ3d4Z3aA=="
].join("");
function decodeBase64Bytes$1(encoded) {
	const binary = globalThis.atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
function decodeRing3Alpha() {
	const payload = decodeBase64Bytes$1(PACKED_RING3_ALPHA);
	if (payload.length !== RING3_PAYLOAD_LENGTH) throw new Error("[BAClickFX] invalid Ring3 alpha payload");
	const alpha = /* @__PURE__ */ new Uint8Array(32768);
	for (let v = 0; v < 128; v++) {
		const columnAlpha = payload[256 + v];
		for (let x = 0; x < 256; x++) {
			const index = v * 256 + x;
			const prediction = Math.round(payload[x] * columnAlpha / 255);
			const packedResidual = payload[RING3_PREDICTOR_BYTES + (index >> 1)];
			alpha[index] = prediction + ((index & 1) === 0 ? packedResidual >> 4 : packedResidual & 15) - RING3_RESIDUAL_OFFSET;
		}
	}
	return alpha;
}
function clampIndex(value, maximum) {
	return Math.max(0, Math.min(maximum, value));
}
const RING3_ALPHA = decodeRing3Alpha();
function sampleRing3Alpha(u, v) {
	const sampleX = Math.max(0, Math.min(1, u)) * 256 - .5;
	const sampleY = Math.max(0, Math.min(1, v)) * 128 - .5;
	const sourceX = Math.floor(sampleX);
	const sourceY = Math.floor(sampleY);
	const x0 = clampIndex(sourceX, 255);
	const x1 = clampIndex(sourceX + 1, 255);
	const y0 = clampIndex(sourceY, 127);
	const y1 = clampIndex(sourceY + 1, 127);
	const blendX = sampleX - sourceX;
	const blendY = sampleY - sourceY;
	const lowerLeft = RING3_ALPHA[y0 * 256 + x0];
	const lowerRight = RING3_ALPHA[y0 * 256 + x1];
	const upperLeft = RING3_ALPHA[y1 * 256 + x0];
	const upperRight = RING3_ALPHA[y1 * 256 + x1];
	const lower = lowerLeft + (lowerRight - lowerLeft) * blendX;
	return (lower + (upperLeft + (upperRight - upperLeft) * blendX - lower) * blendY) / 255;
}
const TRAIL_TEXTURE_CHANNELS = 3;
const TRAIL_TEXTURE_RGB_LENGTH = 262144 * TRAIL_TEXTURE_CHANNELS;
const TRAIL_TEXTURE_COVERAGE_LENGTH = 262144;
const PACKED_TRAIL_TEXTURE_RGB = [
	"LwUAAQD/8BD/BQAPBADkEPwFAA8EAP///////////////////////////////////////////////////////////xUQAwUADwQA",
	"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",
	"////NgO+CwFjFQMUFgEwGBcAMBgBRxgACQAB40UBDQABMAADSxcBEQAGLgAP/QVnD9wXBggXAAGuAA8EAA4A5hYT/z0vABAAAQQA",
	"KAH/SQAPBAADAABIsAT6+gX6+wX79Pn0EwAPBAAKApAwAjlCAPQLATIXIP7/AgAAjAECGAAIzEgBBAADY3gR/1GQA3AXAAAwAmzA",
	"IwD/hREy/v7+TBcDnRETABgAD0MFOALAAAKrAAAIMQAUAAAEAAUYACAAAkVhAAoAAXoABRcAAg4ADwQACwCuAARPAgaFAi0CABAB",
	"DwQA/////zAPHEEJD3EKiw9wFwUCBAAPSBKJADMYAXwIDxsY////qw8EAAIPMBgKAgQAAPMDAfwDAA0ADwQA//8NDzKvlQ8EAP//",
	"/wwPcxeaD1ILCw8EAJUPxgALPwICAh4ACA8EAP////8aCGAwDzAYEgG1FgC9RQ99BHQBuQADBAAQ/ugRAEYvAbAADAQAAsMGAsYA",
	"CgQADzkSAAJFMAKtXg8EAEoAHAsF9L8BBwACvQAcAQzAAjAYD/QFCA4wBgIzGAAKAA8EAEcAlQABwxgCXwEAEwAMBAAA1hgCHgAC",
	"BgAAFAAAQgIC3gADPAAE5wAPBAD///+YDm4EDwQAcgQGlg8EABEAwxIPthYND+cAgA+TAIAPBAD/////zg9wBf//////Yg8EAF8D",
	"8DACJyQPhhD/NAk1BwJZAQAKAA8EAP///y4PmwQEAPIWBD8VBUBHDwQARAJgMAAKAA8EAH8CfEcAygUADgAPBABBALEWA1UXIP37",
	"/kYPDQFfCDAYDbYYAwQABOQYAIUFCv8wAgQAA8MADwQAagA+AQAIAA8EAP///8cJ6hsPBAC6APUuACGuD8I0/////0IPBAD/////",
	"//8UD7AiEQ8EAP5fAwQD/vyqC0UP2jT/EQ8UkZwPBAD//1sC0i0ACgAP9l0ZDwQAlgKGFg8fBWsRAZsuAAoADwQAGcAEAAMCAAYB",
	"AAgAAPcQAAUEAAOkAVcDAgD9/wzYD5UHfQV9EwIGAA0EAADDEgWdHQ8EAP//////////////////////////////////////////",
	"////////////////////UkAD//v9yKYPADb/Dw8EAP///////////0EP/UH/IA8EAE0P/QuKD5wAcwAjPQCXVQAMAA8EAP//////",
	"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",
	"AwIkAAEEAANjAAEFAAiNAAAGAAEEAAJRAAMnAAEEAAImBAANBUEAAPz8URABT4MyAwID/RECEgACOQAACgAAcwADCAAOYwAFJwAG",
	"YwAEGwACBAAD/QVA+Pjv8voLAu41AAcRAQAMAFwAB5AAAG0RBFEACKgABScAAgYAAA8ABG4BAncBAIcAAAgAAzAAAicAAgYAACUA",
	"B0gABeUFAgQADhgABTYAAcgTBJIBAQQACAwAAKsAAAgBA04qA6sABDwAA68AAQsAABgAAaUAAA0AAQQABR0ABAgACQQAAB4ABEQB",
	"BdMXABUAAAgAAAQAAocACDwACB4AAMsAASEAAw0ABEIADwQA//+bAtUDAAoACwQAB80CD+gXEQgEAAj0FwatBAQEAANyAAEFAAME",
	"AAdfAA8wAAYBBAADfgMPMAARAQUAAgQAAsYDAAoABfcFAgQAAjsAAU4AA1oABAQABScABmAAAggAAS0AAGYABzAAA3IABAQABc0d",
	"AI8EAAgAAKMEBeI1ALEYEPrHWQANAAqMvgYEAAFIMAZXAAJ1AAEOAANYFwL3EQIYAAEEACH49LiPEPW+gzD4+fv0FwJmKgG8FgGd",
	"OwYsAQBwBQSs1wlA7wTVAAIOAQaBAADsFhD49S4Bc+8R+zkAAwQAAtcGASkABfAAAEsAABgABK8FAEynAPEXBRgAAAkAIP39RhgC",
	"YwBS//36/waQAACxBgUUAQCkJRIDGAABqAALGAAAPAABGAABIgACBAAT/jwSAGcAGQKoMAAHAAGQAAJfEwLjAQX8AAAEAACcAAE6",
	"FAAwMAFsAAAjAAMhMAF3AAHYMARgAA/0F////xEFcQQABAAC1HYEPAMFBAAChwMACgALzQUNMAACTQQACgAEBAAPMAALAgQACGAA",
	"BgQAAjgAD7QDBA8zAAAPMAAKBQQAAkxrACkEBAMGDrQAANlNAk4AC40GAsMABGMABckAAFgdBPgKABAAAvoFAAoABgQAMvX19cpT",
	"Ar6DAfMXBIoAAWwABQoXABIAAUsABVUFAAcAAQQABWMABQkABQQAADAGAFkHAQwADksAAQYABf0FBroABRgAAucAAQ8ABcQLACEA",
	"ASoAAgUBAjYAAgwAAC0AAB8AAAwADxgAGAAaAAZZBwAeAAEqAAMJACICAzkAAQYABjQgBQQAAeQABjwGAAQAAgsAC5BCASEADD8A",
	"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",
	"AP///////////////////////////////////////////////xEA"
].join("");
const PACKED_TRAIL_TEXTURE_COVERAGE = [
	"LwUAAQCHEAEFAAcEABD/BQAPBAAcDEQAVwAAAQABFQAQ9wUADwQA///////////////////2EAMFAA8EADgQ/QUADwQA//////+d",
	"EAgFAAMEABD4BQAPBAD/3RApBQADBAAAAAIEBAAAEAAPHBcVBDAADwQACQ8kABEEPAgACAATBwgAABAADwQA/0oQJgUAgwAAAP4A",
	"AAD6/AEABAAAfAEACAAAFAAADAAb+5ABCAwAACgAAAgAAAQABBgAAFAAAAgAAAQAABQABGgKAAwAAAgAAAQABAwAAAgAAJMZAAgA",
	"ABAADwQA/1oQJwUAB+ABAMwBAAQAAPgBAAgAE/QcABP1CAAEhBsADAAACAAABAAAKAAACAAABAAAOAAACAAIIAAAFAAQBgkAA2QC",
	"AQsAFgEMAAQsAAMkABT6LAIPBAD/UgQAAhP53AEACAAA0AET9gwEF+8IAACoAQAkAgAwAAAUAAAIAAAEAAgMAAQ0BggUAAjQAQUM",
	"AADxAwAIAAN8BAALAAQcAAcQAARvAA8EAP9LANgBAAgAAJMBAHgH8gMCAAAACvsAAA37AAALAPcAAPUoCjDwAAAOAAEQAgAQAAIa",
	"AnMAAAr+AAD9RQCQC/4AAPwA+wALDQAhAP0YAFANAPsAAiQAYAAAAAIA/mgENPsF/CwAkAAABfsAAAQA/BgAADYAIgX9LAAQ+4gA",
	"EwIfAgCYAgAIAAgEAAQwAg8EAP8uQAMAAP1sARH/AgTAAAAG/QAA/QUAAP8G9AVACwD3C5ABEPKQAwEQBhH4CgIAOgAQCKgBAAkA",
	"ATAAAQ0AAEkAIQAFTAJx/QADAAMG+tgFAGEA0wIAAPsDAAEAAgABBvp5IgAcAAAIAAA3AKEEAAD5BwD5AAT8/AMAkgYiAgObAAEg",
	"AgAoAAQIAA8EAP82AF0BAKwBAAwAQP8AAP0MACH/A4ABAZ8HUwsAAPUNpAVACQAAALcBAPYDAO8DQP0AAPgQAAAcAAAsACD+AwEC",
	"EQDwAQDDAwCgAxH9DgARBuwHcAP6AAX+/QMAAhD6FgAR+2gAYPoAAAcAABgAIAP6CgARB0cCQAMA+gZYAEAEAAT8lABC/v0EAC4E",
	"BAgAAHIADwQA/zAA/AMCawcAAAgBswEEXgEAowEAEgQSC3wFEA4FAAEAAgAcCAAVBjD7APcHBhD6PgASA+IBASQAEgPbCQBMABH9",
	"RQAC1AkBCwIw+AMBVAAAFwAAFAABLgIA4AEQ+C4AABYAAGQGAAwAQQAGAPjsAQIFAABkAAAIABEDHgIAEwADpgAPBAD/LQCDAwDM",
	"AwD8BSEC/nkBMAAB/QwCAgQAAJwBABQIACQAAAYE8AAR+wD8CPsN+/UADvQG8AgYChAGHAAA3QEE3AcA1QEA8AdA+gD+AwgARAL+",
	"AAYRAvEECwD+APwA/AAF/QAIAf4AAPkA/hQIAFgCAPgHAPAHAJQCAOIBQAwAAPxQAAAUAAA4AED5AAL+sAQAZwQAlAIACgIBsQAD",
	"XAADCwAPBAD/HwBwAQFYAwBdAQB1BRID/AEAYAEACAADJADwAgD9AAIA/wUABf8IAPgCAAANIACQAgAA7QwA9AAIFQZQAAIAAvvb",
	"AUEA/gMD/gcCUQQSAkAAAGQAAAAIMfwABRAAAFwCAAgAAAQAABwIANwHQAQA/AKUAgAcAAA7ACAE+XMEUP0CBPwCCQQQ/AgAAD0A",
	"AiwABKsEDwQA/ygSAe8HIAD/VQEA5wkQAiIrIgD9rAEBEAgw/wH/wAEBEAAEcQETCKsFAJ0BAQgAIPkIPQACOAoALwIxA/0DNAgB",
	"NQACUAAA1wEAGwBBAAYAATQGMAED/dQBAAsAAegBAGwCAC8AQP8AAPzkA2ADAP0D/QckBBEDJAABUAAAGQQARgAz/QQAPwADkwAP",
	"BAD/JwBrAxADfAED8wEAFAARAxACARAAMAD9/yIAAgsAA8oJACMA8AMAAAARAAAJAOwT+wAO8gr3APi0AQAgAAFFABADPAwANQAQ",
	"/agBIwP++gMAsQEhA/ljDADGASEA+8MBEQMEChD4LwAgAANoEhEECwAAQgQgAPoiABL8EAAABgAC9QEBPQgBaQAADwAPAwL/KDEF",
	"AP3sBRABrgMQA+IHAe0BEAD0AwEZBBAAvwEA6gUAJgBRAwD/AAbmBwArBvAD//8AAAr9GP72APgJ+BHxCwDtOwAAuAkAqAECLAwQ",
	"/VQIAEgAAVQIIAQAzAcR/A4CABQEAt0NAGwEAIAAABwAAJAAcQoA/gD6AP4lAgBYCKL6AAADBP0AAA38WQoANAAAHAAAswYQBrMA",
	"IwAEihACBAAAbwAACAAPBAD/FADUAQDgAREC0AEAuAUA6gEA+QUAlAEAIgAA/gUCCgYCDgACEAARACkGcf8DAwAIAPYYEgCYAyH7",
	"8iwSACAIIP4F8A8AFQQR/jIAAFgKACMOAg4IMP0AA+AFAKwBAHQAQAH9AgDsDwAMAAAWAgToBwCaABAE8Q0AcwBRBAAA/f0MBgGa",
	"BABdCAA0AAEYBg8EAP8lAHwDAXQBAE0DAPsDAPwJFP17AQMUAgAMAAARAAAgAAIqCAGAARD/nQEARQAgAAr0AVAA9RMA7SYOAAMC",
	"EP3FARIA8A8AIwAABwQQ/rsBEAPsExD9BQABeAAAVwAAwgUAgwAByAEQA1cCRAEA/ASEAAAIACD9BAwAAAQAAGQCQAQA/AMUAgEQ",
	"ABL8aAgANBIAFAoAQwAPBAD/HBADAQoB8gEFRgcAWQEAEQAAgAEC9wMBEgABBQAA9QMBHAABMwAEEAoBDQgAIBIAoAExAwD3zw8B",
	"FBAANQAAZQIB7gcBDAgBCgAiAAFuCAINAAEFAAJRAABOAAb8AQBHAAUjABABFwoB5QESBCQIMAD8AzwCAIAOAHgAAhMAACsADwQA",
	"/xgAdAcAqw0ARAMRBaQHIAAAmA8AcgER/vUFACYAABgAABIAAL8BAJcBACIGADgGAKwDAkAIALABYQoA/BQACBQUIQnvtAFQBgD9",
	"APsICHAF+wD9AAH+/BMBRwoAtAMQA3wAAcgHEQEMCAHxAQBuAAB4BgDkBwAEAABUAhP6KAAT+jMCAGwAAKwAAPABAEQAACgAIQQG",
	"igIQ/ggIAMwAAA0AABgAAAgADwQA/w0AeQcBjwMAXQEB1AUAVQEAGgAC5AEABQIQ/6QRARMAAKYHEQDEEwEOAACcAwE0ALAAAAP/",
	"AAQE/gj4CDASQv8AAPAUEBEF8AEA7AUBPwYRAg0OADkCAQwIAPkBcQH9AAME/ADUBQAEAAAmGgDYBwIMAADmARD8pAAw/QT8/gEg",
	"/QMABgBNDAAkCAAwEAATBBADIBYw/AACCAYDbwQPBAD/EwYsAQBWAwBmBQKgAwD3BQMcAAAHABABlAEAWAMADQAAKgAAIAAEHQAA",
	"OAIBNQAAEQAhAAgMCAHsATQAAPj5EwMACAAIEAE0ABID8QkgAP5jAADXARAEBBgjAATUDwEMBkMDAP0EPwAANAAgA/7pAQEUDgNE",
	"AmAEAPwE/ARMBAElAgAEAAA9AAAyAABXAAKDAA8EAP8MEAPTBQPgGQBpAQDMBQBcARD8ogMCAAQCbAEEHBoAJQAChwUDYwEBJAAB",
	"sAEBggUBBAARESEAQfkL9QioFQUqACD9AxgAAf4NAQ0KATcAAXwEABQCABcAAQQAEP1MBAD8AwANAAI6AAAEAAL0BwUYAACHAhAE",
	"9AEDEAAALwQgBPoUAgIvEAN2AA8EAP8MEgFUAQAwAQDIASP5BpIRIQj7FAIBqB8RBR0CAykCIQAAkBsDlQEAiAkAKAAQBDgCMQUA",
	"/hAAABEA0RH6+xj88g3zDO0AAPf6ExH7MQARAgogABkOEQBwGBH9ZwARAwwAACAAAGUAEQECCCD+BMAHANcHAPwPACQCABAAIgT8",
	"cBgSA7kAACAYAB8AAZ0AMPoAADYOEATUAgAZABMCkQIAWAAACAAPBAD/AgCkEQAIAADAAQCKHTD+AAUIAgG9EVD/+gAF/3QPAHkB",
	"MQAA/qghAXcXADIAALgBANgBAukNEf8PAAHTBQERAGH/Bgb6CgDXEzAA8vIwAAAeAgBuADD9AgIUCgIvAAEwAADuAQAZEgMEBAAC",
	"BjD9A/3wFxD85QEAzQMQ/UAIACAAADAAAIASEAQMChP9/AEAOAAAQAYAnAAw/AAC0AoQ/C0AATAGAHwADwQA/wgQC2EHAdgFAY8B",
	"ATEBAAwCABwAIvkGGAAhA/reBxAD3BcAqQkAHAAAdwEAfAERASAUACgAAJoBBCsGsgAAAvoABv8OAAAMDwAQAAMCEQa/EwCZAUEF",
	"AP4BYQYApwEAywMACAIE5AEQAw8MASkIEADcByH9BPAJARAAAUkEASUCAWoAARQAIAAAGAoAEAIBDAYQBDMCAAQAEPyrAAASAAGA",
	"AA8EAP8HA8kZAOgBAN4lAA8AAgwAArgjAAwAAMUfAXQFAMwHAGUBEATwAQL5AQAwAgD0AQAoAACTAwUQABAGuBkwAA7+FBJSDvIA",
	"A/dgAgA0AgAgAAAhEEAB/QAECRoAUAYADBQAJAoAPgATAQgCAOEHABAAAM4BEwEgDANfAAATAARrAAMMAAELAAIjAAEQAAEJAgIS",
	"BAAaAA8EAP8FAKwLALwBEP7hASEACvADEf67GRMHDAACEAgAXgEAzCcACAAAsAEApBshAQLKCQGFAzD+AP5IEgUQAACdAQAIDlD9",
	"AAAV/EAoEe0QAhAGHCgAtwMgBQFcAAIEKCL9+xgQANgFAEAAACMIAPgjAAwAAIsOAOwPAEAQEgIUCAEMEEAD/QAGPAwRByMGEP33",
	"DQIsCCMAAigQcP0ABvwBA/nJCgCNAAUtAg8EAPsA3AEAiwcEHAEC9AEACgAC5AMAHAAADgAQ/xMCABQoANwDAcgFARcCABsAEADQ",
	"BwBAAAAwAAAHCBAF8CkCKACB/gUA+wQIAAtEJjHzAPNCJgHgAwADHgBBBAAQEEEGAAAB4w8gA/0TAAD8BwAIDgD4BQDgDwANBAC+",
	"AQCAIAAQAAEcBgDYAwQIACAAA/EDAAkCAhAOQPwDAAEsECAEAUcWARgAAakADwQA/wEA5AUASAMA3AcAEAAABAAG9AECBAAEDAAD",
	"5AEQ+tMpABAAE/5ZARH9NAoDhAEAwQEAEAADTBQA8AFQ/wwAAPcIBgM8JgDlAQDYGwNoADL9BQF1DAEwAABlABAD7gUAYAYyBAD9",
	"4w0AoB4S/G4AMAQA/wwGATwGARoCACAIADoAADgqAS0ABAQAUAT8AAT9EA4BDgABIwAPBAD+BKARAHcBANcDAqQJAfsHIAD/HAAC",
	"CwAR+sgBAQACIPoGGCwR/ycAAFsDAT8AAQ0AABEEAMQBAEwAEPlIGgBbAAEaAGAADAwA6xO+ARD9BgYAxBEQAUEAACoAMP0DBGgM",
	"ATYGAEsAEADKEwA8AgLFBQAjAAK/ARAEGgAAEwABDwABCQAAYQAACAARBFYAARgAEQAYAgC2DEAEAAQBcwAGFAIBiwAPBAD8EQaw",
	"BwB9ARD+jCkAvCcQ/RIAUAAA/gEH8AEBDQgBBQIATQEw/v4HjAEBwAMBEAAAGQAAjAcwAAD9/AEA5BcAEwAAmQ0QAfITAWAAAF8A",
	"QBQA+PhGAhHwrB9A/fwABrobAB8CAMsLEv79CUAA/f4ANCgRAwgAAd8BASgMAI8OIAD9cAgB/QVC/gQCAaguAOwNAEgEEQdTHAE3",
	"JAFFAgAUDAQICAA2DED5APwADgIAHAABaQAPBAD0AOghAEQBAwMwEv4QAAAmAQIQAAAkAAAOAAAMAAAAEAAMAADgBwAIAAAsBAGk",
	"CwG0HRD9pAUAowcAAwgCuQEAQwAA/B8A4QEAVDKACvb4CO8RAPJNNjIGAProBxEDsQMCMCgR+ggAAA0KAK8DACAYANELANUBIAf5",
	"6A0AJAgCCAAQBBwmAd0BAFwCEQD9AQAFAAAOAAAXAAQQAAA7DgCwABEEDgYAFAAA0gAPBAD4AMkXA8UBQP0AAALsJQD4IwAQAADx",
	"KQDYEQCMDQEMAAMACgDAKQAIAFD9AAAG/2EBATAEAQgWAFIAACgWBkMAADkaAAgAAYoDYAoK/wAB71QwQAUC+wbsAQAFGhL+xSMA",
	"8iMBSgATAd8XADMAAAgKAEgAQP4HAADcFQAUAALcARAD8AcQA+gDAAAEGQQICAEcABAEUAwBCQCS/AUA/QX7BAX7qBQAJAAPBAD1",
	"AJYBBAgABAQABBAAAHgBADABAfIhAK8TAK0FEQPIDxD6XAMC6C8RBPgBAIQBAzcAEANzDQBHBAIDAgC2BQAZAAHbAWAAABEBAPny",
	"FxD8EBQA7CcCAAQAIgAQBE8AACgoMP0AA/UTAPAfABcGADgoABg0ABQCAIwCQP79AAQjCgEIAgAEAAWxAAcICAAEAABVCgCtDgEM",
	"ABAFfQYB5g4PBAD5IQL/OhMApgUCRQES/X4XAAwAACAAEP0wVwD9BQDQCQEQNgGsAwB3DzQA/v4IAAIEAhD/TCgADAYB/AsR//Af",
	"IP798DUAXjAwAAMCRQSR/QER9QIBBfgBLSgALS4Q/mMKAEACUP4ACf39OSSgAgH+Af0A/gIABsMDAAgAQAD/AAceAgBjCgHIByAA",
	"AbgAARAQAGsIAIEGAKcUAaoCEAX4CxAAHBZAAf0HARAQQPsACPyOAkEABfv8TwgBUAgBgQAPBADtAssfAKYFAA4AAPcBAAcGAeUB",
	"BxEAAaQxAg4AAQgcEP9UBwAVAAQIAABIDADAFQAEAgCFARD/JgAANQAAOAIDVAIBIADAAwEACwv2AAvuEwD2NSgAMAIhAf0hMgED",
	"CAG/AxD93wkAYBQB8QcAAAgCfAAAQCQRBAgGEAQgGAAUMAD0HwDfCxIB4wsABAABCQAASAAARQRgAAUA/vwFVQAAqwIABAQx/AYB",
	"JgQPBADyIQL+hy8BxAEC/AkG8QEDEAAAgwEBFAIQ/vwnApwdEf1JAQEQDhEFACIAFA4AzRcApgEArBsARgAAwAkAzAcAQQABXwoA",
	"vQXB/QAD/gALAAoBAO0IGxwg/QMoBAAEBAAQOAT5BwG5EQEsKAEPAADBBQIJAABEAAAJDgDkAQQEAADoBQDpBwIEAAC0AAIUBDAE",
	"AfzAHAAkAAAHCAAUAEIFAfsFTgoAIQAPBADwAqQDABsBAPwJAOsHAIYDChAAAHkBABIAADsFAIABAbwrALoXAegZAB4AAQgAALsB",
	"AQAEATggAOUTAg0AARQAA0gAIP8DXjawAAv/FesT9An3APfwBzABAP04MAC+AQAkAAEiABMAvg8ACAAD0B8ACAQAKCQAoQBBAAH9",
	"BAgIQQD9BP8HAgEsIgAvDAK1AgAABAQoAgBHAgIIAADfDlD7B/oAB3AGAP8ADwQA8ADoDSAD/v07AM8DAc4BDRAAAJELAMIDABgG",
	"EAPdCxD+DAIA8hcAmAsARgABCABQ/gMB+gIaAAGkGwNAKABGBAA0MAEMAADDD+AAAAH9/wIS/A3wCfAI73YQMPsD/WIEAGYQQP0A",
	"AAEUBgB9AAAEBAAIABAACBQBIyABJkAAFwAAZQAQAk0AEPqaBCAEADEGACwYADQIEP1ANKEAAQAF/AUA+AH7pQgCHxAAtC4gAQSs",
	"BACKFgBEAAC7AA8EAPIA7AMASwEEGQMMEAAA0QEAmAMCvyEBFwIB2AMB3gEUACguADRAEPojBAEcAAAIBABBCgBHBAHZBQANChD/",
	"nwOhAwL8BQX2EPAQ/1tEMAUA+TUAADQAAwgAAPADAH0AAMkTBAgAAtcDAEg0AEUGMAQA/e4hMQYA+hAQEf30DQDMAhEC7AEATAAh",
	"BP0EAgAZAAA6AAACAgIZBg8CBvcAXAEBCAALCAgIGAgAIAABDAAAmQEBEQABxAEBBAIg/QEFBAD8EQGWBQBlBSAG/+gJEv2oAQJA",
	"BgQmIADgGTACAP4EBkAGAPoSWEZREe8R+/tKAACnEwCvFwH2BwDgNQAjKCD+BC4EUAIA/wT8KCAAIAABeAAAMQAA7QVQB/kABvvc",
	"BQBoAADsFwEsBgBsAADyEQEzFgEUGgISAEMABAAEFiQQB2xCANEOAA0ADwQA6QDQAQPoAQBEAQT4BwcQAAHyAwHAAQMSAAA5BQCo",
	"AwHmBSD9ASUIAC0EAHoBAG4NASYAAAQAAAAEIAD9EBACtAEA2wMA/AEBLCwA8gkAAgIwAADwRAwACAgA1wMiAAQ4AiEAAPABALcB",
	"AREEAAQGAEQqASAAAeENAfMrAMkDACgqIgMB8CEA7AEAmggBDwwC7QMASx4ACAAASghQ+wT9AAb7AwH/AQF2DAIbAA8EAOkA6wEA",
	"6AEApQEH+AcATAUC9gEA9gcBwAEAmRMB4xUAFwYBCAgQ/4ktMAAA/50HALgJIP4AIBgQ/CQMAJAPASICAVIAAVMAAckBAD4CAVYA",
	"AApAcAgAEfj6C+9QAABJBAArABD+JCgA3AMA0RPwA/39AP4J/QD+/vwA/gYA/gT9/CsAQAQA/P5cJiD8A8wBAGYwAOwXUQYG/AD6",
	"AAQAGB4ANhIAHx4AEiIAIQQAcgCAAQD/BQICAwEmAABSEiH6AMAOABsADwQA6gMCAgAEAAD9BQCbKQAMAAAvCQG4AQCSIQMRAAHd",
	"AwIvBAEPACAAARIAEAEiAAC0BwA7BCEF+5wRABgAAS0AAPgPAwcIAAcGEAMcEAA8IgDoBQDzCQC8CSPy9nUAIAP9wCcA+EcBDC4B",
	"NwhwA/0C/gT8AjAYQP0E/AKgMgFdABD9BAgA+AcApwIAXAZBBAD+/CAEEANLAADyBQT6ATAEAftoSgOMBBEGFgAgB/kKEADWGAAU",
	"AA8EAOsI0AEABgAIEAAAxQEGEAAA0gMAFgQUAigIADcEAL4LAcADAfgJEAXoSQDUIQClAQIFFgBEAAE3MgAABgAEAAHPCwBIAFAK",
	"AAzvERQYEPZVAgAsAgEwAAD5AQAIAAHwMQE7AgF5AAAPAiAB/AkEAEUeAOoJAPMPIPwDAAYAXQIA7AkSAw8kAAsAAAUmAgwAIP0F",
	"iTQBDAAjBgH4BwIFCg8BAvMAfQEBBQYF9wcB8gEC+AEAEgADCgAAGwACIgAgAv7QAQMXAAC5BQAIAAAuBAHoSQCmSQGpDQEaAADb",
	"EwA6AAAzAiAD/xICEAJPDgAoEEIACvoRSk4AIygQ/vQBAAAYBAgAAXgGANABAO8HATo+EP0BHAQMMgBEBAAEAAEmQAIsAAE6CAHi",
	"AQAVGhD8BwIAFwAg/AUfCgEBAgA1CAIIABEBliYACwAPBADkADIBALQBAMUBAYAFAd4HAbo5BRICACgAAL0BASAAAYQJAs8LAHAP",
	"IQD/rw8A5QMA7Q9D/wH/A9wrALwrQQD+BfpRAFD9BgD9A2gkADMCAKABAFAAAwMo4AAEAf0Q/AUABAzyAAD8JzABJEog/QPgDwDn",
	"AQDgCRD+TCAABAoAPgxlAAMA+QH+FDxAB/0A/CoYIQf8ZhQg/gf8CQGSBAAvCBAA/hUw+wn8JEBR/AAI/QLdAAHVSgH+ASQH+QwY",
	"DwgE7gLxAQAKAAHgAQTeBQAEAAEQAAMgAAEWAAEDBAMFBgAVAAITAhQBLUYAwgEAxDcQ/+gfAacBEAPCAQGWAQBLAAAvAAAgFgFL",
	"AKD+AwP8DwAA8A7yVxYBhwEBzgcAFCgB6EUA5AcRAgQGAOwPAQgAIP0COx4CDDgA8QUAOQYQBBg+AA0QATkAAPkDACccAEgUEAX9",
	"BwAcDCAABY5KIQH5AQwBJQQACgABCAAPBADxA+IBAJUBAYAFCRAAAA0EAQ8AAQECAxIAAdUHAM4BBCMAABAKALAHAOUFAHwLALAz",
	"AM4BASQAASMAASMCADUOEAMWCgANAGAA/Q8A8Q/YATH0+gCzFwPLBRD8NQABWQAA6QEAXwAExQUACQIAGAAB6A8wAwAEbxYDAAoA",
	"KgYACAABQhYALQAARQQAsBgBCAAACgIBTRwQB/oBAQMIAqk6DwQA4gCMAQAIAAUEAALcAQAEAABHNQkDBAHKBwAKABAAyh0AEgAA",
	"kQEA7AUAxAEADAAAAwQBIQAQAwQSAIoNABAQALsBAcQBAQQAQQH9AAEzEAEcDgOPHZADAAAP8Q7yD/EIGAERAAFkGADkFwD8AwA0",
	"GiH9BBwIAPAXAFEAAQA2AfADAuAPAAQAAH8ABQgAACcIAFsgABEAIAAECwIBUgIAHAAAYQBABgD6BhsWAAcOA75MDwQA4gK/AwFv",
	"AwAJAAKOTwCaAQAdAAArBwYQABD+4QsDtAcAEAAAjh0A3QcA8QcA0QEAJwAAyBcBUgADxBcAEBAAnAkAJh4RAsgBIP4BDh4AMgIA",
	"UAIAFg4QAjAA8AIAAA/4CfcG7gnvAAUA+AACAhs8AMwBAEQEAGoAAXIAAm8AAOc3EgIYAADTAQAIADAEAQTzNzD8BvzCOEEA/Af8",
	"kCwAkxwB+wEg/PxbBgDAIFAGAwYBARcwgAb6AQD5BQD7AwQQCIEKALBGAGAADwQA3A8DBAgCBAAFEAACLAICEQIAEAAAFwIA9wMD",
	"NBYBEwAAYAMEDQAD4AUAuA8A2AMgAwC8BRADGAIQAWFKALMHEP8kGgNSAAAwOIAS7hHvAAAI+OgvEf7pCwAaAAAKDADQAwDpBwD4",
	"B0AE/AT+DAAAWgAAJgABlQoAdRAB8BsAOBAACAAAEBQACDAQ/gMEAIkwADgGAE8AEQATGgCZBmAH+gAF+wgEDAIDBA8MDvMDkAEA",
	"BAAAzwEDEwQAGAIJFBgBBAAA1AUAMwIE9AEB6QUA1AUAJBgA4A0AyQUAFgQAAgww/QT+lBUBnhEABAYATQADUgABPAARCgQCUfj4",
	"AAgC7kEB7xcA6w0gAwLoRwATAEAE/AL/4QdQA/0D/gTwKxACAQICigIAKQxBAPwE+g0QMP0E/PoDAdIBAEcAIAAFFAIAZgAgBgEU",
	"AAALHnEA+gcA+QX8EA4CAQIPBADlBb8BAgQABfMDAUwHAOABAA0AABYABxAAAHMBAfQFABIAANEDAQgABBEACOABEQMgIAC/AQBe",
	"EAAANAAkKAC1AQAMEBABEwgBWwRhAAr3Eu4SIi5AA/0E+zwAAOgJAOEHAMQDAeQPAMQFAoUoABYcUAEA/AL/GAABLBAApwYEKQAC",
	"CAAwAf0F3gMBCwoAEAAC+gEF+BcACyAAAgpwBwEA+AgAAZEkABcADwQA1wBRBwB6AQDQAQQQAAAIAABRBQAIAAGKOQAJAAHzAwAe",
	"AAAUCAAoAAAQAACUBwCXBwAQAAEhAACBAQDuDQAMEAAWGAA6AADcHxADjzUAlgFQAf0A/QQEBBT/OAoCagAQAXkssAAAAAn5D/wH",
	"6w3tHAIQ/TIOARBSAOwPAHgAAJleAGcUAOIfApRGAIIAEP1CAAAhHgH4BwB4FLAA/gf8AQAD/AH9B80wcPwA/Qf9AwAEMBAJsU4g",
	"AAD5FQCBAAEKFAj4BwDULgAIAA8EAO8B4wMACQAD2gMGEAAA0gMDAwQADwAC4wMJEQABEgACDBAADwAxA/0BaBkAsCEAZAIA0RsB",
	"PQQBAgICJAQECwBwBwf58xXsExwoBv4HAf8XAeg9ADsAEAIFAAEIDkACAAL8CAgCKAAAEwAAJQAAJBgAEQ4Q/BUOQAT8A/w5AAIP",
	"BBD8o0gALAAB/A0CCCgQB900EfwEDBAJAQQFHQQPBADsAlUBAAQAAsgBBhAAAN4BCfABAc0BAAkABQQAAhIAAjkAAswDAPAtAARI",
	"MP0D/88JEf8EHgFcAgDVFRACFg4CAwJQBwjrFOwcKAf/CRACAwYBBAAwAAAD+REAzQEB5xcgBPwICAIUGgEMEAAsJAATDgIdAAQE",
	"ACAF/CwaAIIEAPcJAfodUAcAAAf6+gchBwH7BwAHChAJewYADQAPBAD7ANQRAPgdAWUBAJEBALsNAwwAAgQAAOIBAAgAAdABAfwB",
	"ASUCAdYDABwAAFUDAKwFAAAIEP9aEgDEDwAoAAExAAALEAEvAAEBAkEAFesUVFYS/RIwAL8DAPMJEP/wGwD5AQDWDQCGAADwEQAU",
	"FgAJAgIZKAD5AQAwAgD+LQASBpEEBQD8BP4A+wT2EQARDAJiAAEBAg0AEAAGDgAEAAAMAA8EANQA0gEArgsADAAABAAEHwEA6gcB",
	"aw8AsAUACQAQ/8YBA48DABAAAM0BAyAAAAsAAKIPADQAAPwXAAwQEP+yIwDxJwDhDyEAA7EbABwYABkeMAL8AKAVEAQ8IAMCBAEi",
	"JgCIAAGAAJH9E/sJBPEABPTUPwDnCRAA+B8BtQ0AeiwAcQAQ/uMBMAAA+jsCAKoSABAWEAMnAED8AAgACCAAsAKxBP37AfwABwAD",
	"APhTPBAEa0BB+g0C+1gCIfr65CQAAAYBqEoT+wkCAJQeACAAAIsADwQA7ABjCQAIAAKnAQDnCQHyAQWrAwIRAgIEAAHxAwcxAAH2",
	"BQEBBAAPAACeAwATDAAUAhAGoiMALwAABAACARQAvwMABAYAOhZBAAP+BQgOAG5oIAT8BxoAwwUCBAYAMwAACAAABAAADAAATAYA",
	"fQIBICAAZQACBAYAABYAaiYANhAAPQAABABQBQD8A//BWgHGXAH9DRD6MgAAAQIACAYAiAATAAQCAwwADwQA7wXiAQIEBgb2BxAB",
	"xwcPCxAGAicAAKEBBQcKANhHMAD/AxAmEQYhIDD/AP0MHgJMAgTQAQENAKAD/QAPAPEADAD0+AUR/skBAAgaAPw/AO0DQAQA/f7r",
	"BQAcFgMBAgDlEQD5EQD8GwBMAAD8KTD7BPwABgAYCkAFAfsEGgIwAAX/VAQAkAAACQhRB//5A/3/DwAEAACADBP3BgoBIgAPBADr",
	"AY8BA/EBAgYAABIAAgoAACAqARMGAyAAABoAA8EBDwECAgAJAAAiAgCGBQEUGBD/sA8AuQEANQIAAwQAMB4BJgAADQAAEBgBrQkR",
	"9BMAEAD0EQJOAADcAQAIAAB8AADXEQHiIQH5ARAEKAgABwIAEgABLQAQBUQQADEAAAQAAP45ADsaAAECA+8NAPQBoAf5A/4AB/kI",
	"+AiiDAL9AQAEAAAgAA8EANAAtAcACAABrgEDBAAAswcAswMR/+EfA8oBAQwAAvMDDxAAAgGDFQGiBQEUBADcBwCnBwHeAQBRKhEC",
	"MwAAOAow/wL+tS0Q/ggWADs0EAM0CAAzAgEBLAHvAQAEACD9CQMYQALyAwCyKwAsFiD9ADkIAPdHAUkYEAP4FwAUSAAIACADAQ0C",
	"MP0AAi4UAGgWABgeABwKEAEdChEAPSxw/AAA/Aj/AwA0oAAC+QD5DgEGAvOLCAArMJAAAAAO+AAA//0DDC8J9wQI7ACPAQAIAAEE",
	"AADQAQAIAADLAwAIAAgQAAEBAgUQAADiAwDBAQIDBAESAACoAyABAAMEAA4AAOIBAywoAAUAIP0DJSoADxIB9wUAIgAAUQABDQBw",
	"AwAP8Q8ACTpOASwMAEoCAOIDIf0C0wEAzAsD/A8ABxYgA/4kEAJSIAAbAAIVFjAAAAUMSABOXgATFgAcBhAFVgQA+yMQ+QAOAfMJ",
	"MgcC+AIKAPgDAYAAMAAJAalGAJAADwQA7AIPAQLjAwD0BQwQAAECBAAKAAARAAEEAAMRAADDAQAPAADyAQApAgUQAFEEAP/9AuIB",
	"AHwEAfk1ATMAABIAACAAAg0AADwGAAECQO0QAPK6BQAtYBABOxQA8xcBFQgA3C8AAF4g/AIcMAEsEAAJAgCMAABNCgL7KwILBgEF",
	"AAAWAmIA/AQF/wWKAAD9BUAAB/r5r1gA8wkABAACAQIBAw4fCgEC9QB4AwBVAQHWAQAfAQAWAAUBAgPyAwEQAAEFAAQiAAHiAQEJ",
	"AAMRAAYQAAERAAGsAQCYAQMwMgCOFQBvAAHOCQEmABAAFCBgD/EQAPYFChgANQAB6AcAHEADJgAC4wEBPUoQAu8dAPoLARAYAQ0Q",
	"ABwAAfQJABAYAixUEgQGHgH/D0AHBgL5AxIAJwCwCPQAAAgB+QAJ/vg6AAAIAg8BAtsAjAMAvwEAfQkAqQEECAAAygkAIAAC4wUA",
	"+gURBOMrAuwBABAAAIgXABEQABACAQQIAEEBAAQIAfEBAAQIAO8RAAMGADIAABY0AMcPAQwQAMwhABUAALMTAAgAAEcAAdsZADwk",
	"AOABkAAP9Bb0/gTyBd0BAEAMEAP/LwA2CgABAgF6AgElGAEsABAEWxgAuABQ/QD+BAHwIwAgABAEW2wAEDAAMCAAEQBAAAb+AVII",
	"MQAA+pwoAAESEfguAABFAACVYGAA/QAJ+ACLHACsQgAWAA8EAPAC8QEABAAD+Q0HEAAABgAGIAADAgQAHAIAAgIAEwAAEQABBwwA",
	"DQABwhMAIQIAHAIAgRkAABYBmgEDHgACQQAAPB4CQFYQBgQIARwEAvAHAB8AADQAAAQCIAADEAgAMAAATAQECAACjQAADgQACQAA",
	"PwgAXwACFwYB+A0gBP2RFDAHAPsyACAI+vwFIQX7+g8A+wMhA/4HDA8CBNsPBAANAIApEv/zBQFHAQDgAQIDBgLkEQAKAAIQAACq",
	"AQAyAAQbAgC7AQD/YwYPABAAMUQgAgEZBAEACAAYJgCiAQEcAAAEAAAbSAMvABAMVAQQ8icAAO4FAAkaEAI4AADPBwHQAQEOBCAD",
	"ASYUAlowAOsdAlMkAPIFAHJSEPsUAgB3AgP5HxAHBwAAAQIwAAf2jCBQB/kIAfh4KKII+Aj4CfcJ9wP9AQIPCRD0BQQAIQH/uAMF",
	"nwUA9AUAEQIBqgEC+wECBgAEIAABGQAALgIAqgEA4wcJEAAAxCEA/z0ADwwA1AEDTQQAGwABIAAADQBQAAAM8hCsBSAG+twbAOcB",
	"ABRIAN8JAAcMAEoAEP4tAAAwAAQEAAIcAgDxAQBrBgBhfgEKAjAFAPxLVkAABgICiFIQBgUOIAf5sQAhB/kADAC7bGMI+An+CfgC",
	"BAAEAADHAA8EANMABAgACAAAwgEAqAEATAcACAAAFAAAHAAA5FcA8gEA5R8A0i0C7gcAGgACLA8DEgQALwAB/wEAIxABRAAApS8g",
	"AAMUIBH//CcAygcBEAAAAgYR/foBEAIQMgCuAQBxAAEAMAAMAgIIAHEQ9g0F7gnuTiYAZAAA8xEg+QH2AQHsNQHsAQAoAAAgBAB4",
	"AAAIABH+KgIwAQT6XFQA9AkBaWBABAAHATcwAYJ0AGkIMQLzBAUeUQj5AAj4iFRRAAgA+fekJgD9AQB/aAAlMAHUAA8EAO8ALAMA",
	"CAAAnAEACAAGEAAAxAEE/gUBBAANEQAB8B0C0gMCBAAhA/9LCBADAgQR+iIuAMkBBTIAAO8BAy4AcAoAABTsEu4LAAEACAH1AwFA",
	"EAQLDiEAAAAQBEEAAAgAAoEAAAcWAQkAAAAcAAgAAB0CAAgAAf8FcgX9B/kAB/xnAAACBAJ8LgD+CSED/QAIAAQAASAWABgADwQA",
	"7wBdAQAIAA8BAhYIBAAMEgAB4gEB+QEhAAb9XwHRBQVDACID/jsWADpSYAD6FOwS8rcHARAmAdsFBAECACwAAOcNACAaEAQQJlAC",
	"/QAE/mkWAhoAAAYAIAAFADgADAgADAQB/xFwBvoG/AAF+v0ZIQP9+wkAAQIALQAAAggBBAgA/QEABAAPAQL0AMABBZ4BAbwDCPEB",
	"AskBBhAAByQIBA4CAQUAAhEAAA0EAxUAEACQPRAFigsQA/AvActFAT0AASACAmgCYQoE7RTsB6IXACQCABMAAQgABgECAfkXAAcC",
	"AOYLAO0TAk4CBQECMQT8BcUBEAV4QAIBAgDXAYEI+Af5CPoD/gAIAPIFACQAEAkECID3A/4ACvYL9QQAACoAABkADwQA0wDSBwbH",
	"AQIEAACGAQEQGAPhAQAkAAAECALeUQAGEgCiEwBGVgUQAANBNAAeMAJlfALkHwDqJwE1RAT0H8H/Af4E/QEEAAT7AALLJxMBgnAA",
	"6CMALgAAUABwCRL3FO4J7h8AEAUlAEAEAQAD9D8B7gEAVhgAGw4AKQAA9iEANgggAwEqLDEABAEAEAAEJAMBEDEFBQZAIjAHAPkR",
	"AkEIAAfzIyoAEzQB+BcQ+gcKAAQIUv4AAAr1BAABIAQAXwAPBADvA/EBA6wLCAIEDBAAA/YDALMJAg8AAhEAAicAAgQAARAAADoC",
	"E//OBREBpgEAmBEBHwAAHjACLwBSCgAAE+0ECAAPQAIIAAEQFADiAwA7AADwAwH8BQQADgAuGAIIAAAjAAIJAAA4AAL+LwEEBAEP",
	"AEAI+gAHUEIA/x0R+XMiAAoAAvwNIgv1BAAPAQL/KggSAAIRAAYEAAIQAAD9BwCPCwEIEADIMQFLAAC6BQAEBgJBAnAKAPgT7RLw",
	"uwEHAQIB6BkAKQAADgAACAAAUQAACAAAIAAgBP7VDwH4AQABDiIF+wUKIQf8/QkA/SUBEAAB3gVSAv4ACPr/HQAUACMK9goAAP0B",
	"AAQADwEC9ABfAQJ9AQAEAAwECAwQAACVAQAIAAIQHAAcAAC5HQASAAAEAAIQAAAFADIAAwMPGAPXExL+TAIAyAEBJQABUgBQCgPs",
	"E+1eRgRWAAMIABEEBAIB3wMCMQADBggBDioAGwAAkEQBEQASBQAQQQAG/AbdAUEG+gf9AxgAACADBQoD9wFCAAr2CR0CAP0BQQv1",
	"C/UeAAARAA8EANIA4AcAdQEBwA8A2wMDCAAPBAgJDBAAAd4PAaMBABUkAOwBAIAHAPQHIQH/hK8ALAAABAhwAQD//wMAA/s/AENY",
	"AD4AAB8AALcZAOMTEwFjGGAJE/YT7PlEgDD+BPnpBRAA3AcB/gEAFQAA9REA5wMANwAAJkCg/QAEAgT6AQP9Bz4AATwqAAAQAEdq",
	"EAf7ERAAg2AQ8xlGQAgACPNFSCYACAQIYPYAABD2AYU4Iwv2AwYAhAAPBADzA+EBABgCABUCB/IDALcDDwIEAwAGAAEEAACERwIn",
	"AAIEAACCFQASPAHDHQDUBQDULwIBBAAfAABLCgMIDmEKAAAQAPEoAAFFLgH0AwIANgAFBABBBAQECAQADhAErBQA9wUABAAAEQAC",
	"/xsG/AcQ+INaAQ8AAP8FAOUDYAkC9wAG/fgNEQoPHgH9AQAEAAAwAA8EAPQG4QEBmQEH8QEMEAABQgEKEgACEgIGBAABtQMAOAAA",
	"3EkBCAYAUFABJj4A2wEAQQABMDoAkxsiAwABAgAoAgFSAAEQEAbxFQAFCgAxAAHuHQESAAAYAAD9AQAEAAD+HQIBAiQH+QECAgcA",
	"AAECAQgAAOYFAQQGAQECP/YK9gEC/wAAwAEGzwEM9AcMEAAGAQIA4wEBDAAA8gMAEwAEHgQBvAEjAf+wBxADBQADEwAA4QMDJQAA",
	"PgAwAAr5DBgF5QEARQAADAAA/gEBCAAAEBQA7A0BAggAEgARBQoAAIiCAugDBwESAwYMIAf5DxoA+hkADgAAECQDBgpwCgL2AAr+",
	"CiIaAP0BEAz7lAIjAA8EANQANwcAxwEAjAcA1gMECAAAWgUE5AcAJAAI9AcMEAAAhQUACBAAAQIA6i0g/wOYTzMD/QERIAIYEALk",
	"kwDSSzD6/gQGEADZKwAvABAA3DkCKBABLwCzABLzCAz18gAABAL8BwHwaRH+AAYBPA4iA/36AxAEZBAACgYyAAT3+xcABGAABkAg",
	"BghMPACadoD8AAMC+QAH+502UAgBCPIC+SMA1wgR9yIuAUcAUfUDAAX5BAgQDMAaABkCABgADwQA7wPhAQOnAwDgAwMPAA0QAAas",
	"AwUEAAARAAHQAQMEAACYZQHkBRIE4SEgAwEMBAARAAAeAAEwVAMECBAN3wkATnYAGwQCZAAAEAgAYwAAOgYAMAoAFBIB+gEDBAgS",
	"BX+aAAsAABMEA/4/AQQEAQQAEge0kAAADgAECBAGBAoBIiQAAAgA+wMhB/n+AwAEAABFAA8EAPQEVAEPAQIjASMABgQAAiEAIAH/",
	"3AcQAvwBAONBAHEDAB40A9YhACIAgAAADQD4DwDyaAQALAABRwAHAQIAWwAAbDQBaA4TBIIAAEEoAGAAA0UAEAb2GQD/ARD8CQIg",
	"CPgEAgAYAAD9CQEIAFAAAAkD9wgSAAgGBAECT/UAAAwECPMA3wEAsAEG4QEM9AcMEAAKAQIBDAABBQAADgAAzBsAtgEBEAARAccV",
	"EATEBQEhKARMAgAEAAEgBBAAB44Q7wECAF0AA9EBAh4CBQECAjoAAEoAAfwHAPYZAssPAQU4APhBIf0HyAVBB/kH9vcDAAAQAAkA",
	"AP0JAgIIAgMIsQAJA/YAC/cAAAf7AQoPAgTfAGgDAGoBAK0FAIoBAAgAARAAB+QHACQACPQHABAAAJYLBCgQAIUFAAQIADsQCgAg",
	"AgQIAKYFAuQHEABgIhAGFEoA0gEANAABAQIAQQAgBPwOHABPAHEAEwfz/v/zVAIRAVhmMQAAAxAQAvAFAD8KAP4DASUIAEQYMQQA",
	"/F8aAAZmIPcE/wkB+yHwAQD8AAcD+gAB/Aj6AAj6BQEAJiAIAwV7AQECAIIYAU8CAfoBEwACDAARIAEaAg8EAPID4QEAEAIAHQIH",
	"8gMCtwMGEAABrgELEwQAA0IBJwACBAAAExwB5QcA3xVQAwD8AwK1AQAaAAEEAAEBAgAJAAADBEAA8g/xUwAAY1ABUwAAEEgABwQA",
	"QgwAEQAACBAARAIAJQACPgYAFAQAPAgFAAwABgAA7AMAtIgACAAAk5ph+Aj4AAn5/QMABAAAOAAE+gEBLwAPAQTfDwQACwbQAQzx",
	"AQwQAAHECQIJAAQEAAKSAQYEAAIQAAAlOhD++GlB/AAF+ywSABYAAIsLBRAgQwz0DRABAgAAKgATAAMcJgD8AwArAAEhXgAJAAAs",
	"eABRDgBxBAGMAAL+ASEABvo/BAAQAP8jAAgAMgAI+/wDoAkE9gAJAPYABP8HEAASACEAAAQKEQ05ZA8EAO8AiAEAsAEG4QEM9AcA",
	"IgAACAAGBAAAIAAACAAABAAA7QMCEwQADgABygEDBQAhAAEMGBAAEB4CsAcAVAAAGwAAAgQADwYAigE1EQPvAQIAJAAC5AMA9gEC",
	"CAABhwAAAAoADwADBAAABwAAAhIAGwAAAQIAKQAD7gcAAwYACAAAEQICCAAA+AEAAAwBBiQDAQQAAAoPAQLgANAHAFABAKwHAGwD",
	"AAgAARAAD/QHAQANAADdBQAIEAAMAAIfAAGZBwAhAjMCAAEECAD4DwL0BwBQAAAhAAIECBD/IAgA7wEALRgQBERQAVUCACgQAAEC",
	"IP8BEDhQB/wEFfKLAQDsDQKzYAQoHAK4BzAE/ASTZgAAIAEWADEEAgWhmmEFBQUJBAQ3YCIACwAQMAj6A/sHQgAI+gP6DREJCUpB",
	"CgD59kRQUAr4AAALFQKA+QAN+PwADfNDBAGZAg8EAPIAnQEACAABqgkIAQQCBAAMEAAQAN8RAgkAACcCAQAgCSsEAuQFAAQIAOQV",
	"ACoKBlUAAQECAMwDZAMQA/AAAAECAPcrA0MAAAAIAAgYEABTIgFIBABEBAAIAAAeAAIIACAH/dALIAb61w1RAAf6AAjmigAaAAH7",
	"D0IIA/cA/BsBAAQJAgQAKDQAcwAADAAPBAD1BJ0BAwQABg8AAMgBBrwBAAQAAoABDwQACAAhAAAfBADaBRECAAoAtxsCXwQAIAAQ",
	"BBMmAAkAVAAQAAAEiwUAeyYAQyAABxAAAQIR/A8UAAYAADicIAX9FRIAFQYDCAABOXwB4REAPQABBAAgBf0DCBD7cXQhCff+MwAW",
	"AAH6AQB/KAYBAgB9CiL99joGDwQA7QLgAQcEAAIRAAbxAQwQAADWAQIIAAUEAAKRAQIpAAAEAAQQAAHEDyAF+9QJAcAFBCIAABAi",
	"AfUDIAAQ9jcBAQQBLAAA2wEC8iUF/AkAHAABKwAAFAIARQAACAAAGgADBAAgBv0AEgACLAAPBiII+AsIIAAJBQQAIABCCfcACmoU",
	"AAQAAP4JAnMEAFEwABIADwQA2QCBAwBDAQCsBwCLAQAIAAAQAAAYAAGhAQDNBQD0BwsECgDQAQQQAAA0AAEQAAJGGADzBwEkKBMB",
	"5ScAJAgBEAAAg5gA200Aqw0S/Th4AF0GASAAACkAAIIggQEACP31EP335QExAAADFTRAAgD//v4BAPo1AQYGAZhuMQAABHNKAhoI",
	"AEEAEAb4UwAJALEH/AD8B/sAB/oFAAcQEPisAAIECAHTnjAAEfYdUBELGRi/CPwC/AAOAAD0D/IDCP8GAuIDBhAADBUMA+0TADtk",
	"Ag8AAjEAAvQHCBAAADMAEQNbbCP9A7Y1AgQAAB8AAOZBYf8ABvUU7MUFAAMIAItCAQcWBg8gAKUFMAQD/BgwAiAQASAAAG8wABuK",
	"AP0HAfsDIAX7AQIAHmhgCPsACP76oAADAAgFCAYBBAAiDPW+VgGYPAdVFA8EAPAArgEACAAABAAAoQEIEAAABAAIEAAAIAAAECQC",
	"BAQA8QEACBIA4AMJEAAAMwAgA/0DEABfiAEUAgAdAAIgAgC1Q3D9ABTsFADyejQA5AUCTDYgAgHkAQD1IQADBgAADiAF+yBAEAEg",
	"EDD9BP0mFAE5hAH7AQAJGkQH+gX9AxgAAAYwBvr+AAgABggBCBIDAwgA/gUAGAQADABfDvIAD/H9AfcABAAArgEACAAEBAABEAAB",
	"BQADsAEACwACEAAA+EcACAAH8gMBGAAGEAAEBAAA1wkR/2YDATxSASQGAC8AAikAAgECEPusJQDyAwATAAAIAgAIAAIEAAAnNiH8",
	"BPgxAE0aAB0AABgGADcIAv4BAAYUACUEAQUSAAgCADYAAQQAAP4BAf8FJAn6BAoA/A8gCfqNAHIAAA7zAAv1CwAPBADZAOwHAKsB",
	"AIkBAIQBBAgAARwAABkAAPIHAIkFABEAAAQAARAQEP/QAwDAAQHGCwANAgEbAAMDBgDUBwBEAABMRAAQAAAEAAAyAgBuTAAUKFD6",
	"AAQE/PCjAJVwA41AABQQEf8UKFAN9RTv/OAfADMAABYGAPUxAUAyAAA4AAQKEvw9BhAEuwcAhlBh+wUDBAT/+QMg+QczSADJBQL7",
	"KwD9EwBUYABIBAEABgJ7DEAACvkAIVRhDAD2APoFd2BBAA8A8uS2AUcsDwQA7gF9AQAJAAEEAALIAwPsAwASAgsQAAPCBQILAAIE",
	"AAARAAkhAAYMAAAIEADKGwE1AAJbAAdBAGAHAPkRAPAECAEVAAFEAADoAwAhACAE/C8AAAAEARcABCQEAEICBAJGEv0IAgLKBwD6",
	"FwD0AwD+NQD0DwACNiAE/PcNIAr2OyIAMgAkDPRGACAAEAS5AnoADwQA7gBvAQJlAQAEAAB/AwjxAQCHAQgQAAYECgKHAQDxAQEl",
	"CgIpAAAEAABRAAASAAKyCxAFxncE8wEFBAACLgBQEe8AEO0bPgEBIAAcYgHrXTADAvxXbAAiAADyTwEgJAFMCAf/OREHBQBw+QAH",
	"AvwF/P4NAPU/AAYCEv74CSAJ/Y0kAAECAA4AAgAYAAYGAFYIBAECAxoADwQA7QCwAQLhAQAGAAAOAAK+AQASAAS6CQYQAAGsAwDL",
	"BQIZAAAEAAAHBgIVSgAOAAD3AQIIAAAcAgAEAADGKwwECgBoAnAH+BEA7wf5AQIBmQMBAQIAAg4B8QEAEgAEsQMA+wcQBQxcMAAB",
	"Biw4AMWSMP0G/QAUUQAH+QX9AgYiAAkAGgD6DwL3BwH5EQMIFGAADPYACfgsBAEOADAQ8ftCAgALAA8EANcAgAcAyQEAfQEAjQED",
	"CAAA3QERAuaHAPQHABgYAwECBDAAAPEDAEAABABIAAwAAOcLAEQAAAwAAdIBAUx2AVAAABMAACICAD0AMAEBBtULM/8C/w0cARMk",
	"A3RmcQn1Bg35BfFSBAE8JgBsWBD8OnwA7B0AF1wSBFyQAOiIEPtgABAF208QBHWIYvoD+gMH+VY6AABSIPoE/AGwAAAF+AEG/wAK",
	"APpcPhD9/BcgC/UdXAB8JFP1AAUAAg8CIQAFxZIBCwAPBAD6AJkBAAgABAQADBAAAMABAggADwQABgIQAgHCCQFACgEECAD/AQAN",
	"AAACBAGofBD/ocIDigUA9g8AKAIANAAAQC4AEAAAFgIA4QkAYX4AOVoDegIQBlgOAwkAAAcACQQAAAoGAA0OAPgVAgAwABYAIQv1",
	"GQQCARQhCfl0AACqaAAcAA8EAPcE6QEM9xECEAAACgAEBAAB1QEACQAAzAEAKAAHIQABCwABBQAADgAArAcA4hEDBSgBIygCGAAC",
	"BAAQC0gUEfH2AQEhAAAUAAEIAAAADgNFAAHhCQAjAAACUgARAAYEAAAAQAAFBgEABgHkASUI+wQKAgAwIQv1z8QBIgACAQIiCvYB",
	"AgF5Ag8EAPkPAQIFDgQAACAAASkAAAECAKcBAhEABEEABXkDAtQBAIsNIgT+BAQCCAIBHwAFLgAQD6DIABcAAA0ABwgAABSIAAgA",
	"IQAFUHQA/h9CAwAG/vQLAP4HAAAMIAj7EIhgB/kI/AAI9gcA/g8Q/wECAEUAAAQAAAIoAAIuAP0ZRvQADQMVGA8EAOIE1AcDjAcB",
	"lAcAwQkAY0cAkgEAIAACsQkCAQIBEAAABQACNwAA6oEBWg8AEwAGBhACFgwBChgArVcAHAIQAM8XANcPUP0AAvwCOR4DgBUAuQ8B",
	"/G0ALgCACw4DA/EN9wByYAD8CwAjABABrkwBKgAAbwgAB1wDDQAQ+wEMQAYEBvYBAhEHGwIBAyIQBbK2IAj4BFgB5wMBko5QCvcK",
	"+wcrShEK6AcAHgQw8wEAjk6xCvgAEADyABLuDPqBEgAzAA8EAOoA+AEACAAEBAAMEAAOBAABwQMACQAPBAAFACMGAOABAbsVAbAT",
	"EAccyAVaACUD/kQOERGgGQAKAAAtAFD/BP0DAgsIAgA+AgwYQAX7AwMCfgNtAhAG+W8ABBAAAEgAEQASAAQwABUIEv4CKBAGAEQg",
	"CvYAEgAhAAACPGD7AA30AACneAASAA8EAP8BFQLJGQIIAAIBBAAEAAwQAALoFwIKAAMEAAKNAwYEAAciAiQD/wECAA4ADAQAUBHv",
	"AA4CoB8AKgIARgAACjIAC3wCAX4AIwABBAAE5yEIBAABAAgA/R8BCAADBB4AAgYD5QsE/xUB+SkhCff9ARAObAABAhAwEvvzOAAA",
	"HAAPBADsAasbAwkAAAcAAwMIAQsAAQQAAgECCAQACCAAAQwAALsBAA0ABAQAARUAALgFArgBAW4TIgT8GDoBBQ4DBAwgABHrLQCV",
	"AQDeBQArAAwEABAETSoACQAB/hcAVwAA/BEACAAC8QEA+xsBCAACCGwwAAn8AgQCB88BNwAABiwRAwQCDAQAAZYAAAkADwQA2gG8",
	"BwDuAQMECADYAwAJgADExwQgAAAQKAPzBwEkCACZjQQBBBABIQACKAAFAwgA2gsC8k8BDwABCgAABlYAlHgAI5ZQ/gT9BAFMlgAZ",
	"AADoRwEgAgABAnL8CfYA/Qj9qKwBo1IATAAABgQACAAALggADxIgA/suThAFF0Bj+wAABv78FwwgBwP+TwAEMALLAQFXAACTABD9",
	"/hFQCvYLAAFcAgAbAP8GCfkADgD1AA/xCvsA+wAQAwDwE+0HJlj4CuIFCgQAEQHTCwGaRwAPAANhAQMLAAYEAA8MIAMA6C0ABHYB",
	"0QUBEQAAIAAEBABgBAATAwDvswkA9AEgAfw6HCAABGIGAgYQAVkEALQhAC0AAAASBUoGAPpTAAAiAAwAsAj9BvoJ9wAI//r/9hsR",
	"CQwgMQv1ChYCAPoVAAgABgQAAzAILxPumAYGDwQA4gadAQLIAQIQAAIGAAAEAAYKAALgAQAP0AEpAAAEAACpAQIAKAAOAAIhAAEw",
	"YgEPAAAeAAASAAAMAAEEAAENAAAuAGAE/AARAPMIFgETADAAA/86JgMTMAD/NwEJNgAAFgAGAnEG/gX+B/kCGxgA/SEw/AAH/iNB",
	"AAj4BvgNIgb8/VEhBvtNAAAAEBH7/hcAIwYAEgAzAA/zPAQABAAASwYPAQLxAvABBa4BALsDAAgABhAAAc8BAMcNAfgFARIAAgQA",
	"AzoABusHDQQAANoJANIVAFgOAdwLABUABUwgEAAdTADGHwI0BAMmDgoEAAAMOABeAEAFAAb+tAdDB/kG/tu2AfMHBMQDAAECAAgA",
	"BAQAAP4BAgQKAQIaA/4jAB8CABQAQhPtABPKng8EAN8AwwcBQAEDCAgADAAMFAAECAAArh8ABlAFmgEAKBgBrQESAPFRBCgAABwA",
	"AQoAAQkAAiEAANIHUAIAAv/9xRcQADxIASwQACEAAEcAAD4CYQgDEPz6+5ATAxwAAP8TIP4C8gcCRCIAWwIBLgIhBfoWEgQDRAIA",
	"GAALDgMIACEJ/J5QMAoA+1tgAyO1QAQA/QwSDBAFUBBgDwQA9Abwr0ABcAg/FesCAgj5CQEEAsABDwQABw0gAACjAwAIAAQEAAwh",
	"AAAQAAMkAAAHAAFjUgABAkAAAAr6kg0AGQAIBAAAMAAwAAX7AAoADwAMBAABAwIhAAgGXAAJEgEvACAACCsyAAEYAP5FAPsLEPU+",
	"FAAEJgBSDgA4AA8EAP8LAk0BDwQAAAwUDgYEAALDAQAEAADWAQA6AgAMAAsEAEAD/f8FOXAARAAAMQAAKwABUQAADQBRCwABAO8w",
	"BADqBQAvAAxOBgAYAACgBAAABgCjACIH/goyABwAgAb6/wAI/QAI3WQPAgYAAAcAAAQAMwz/+SYEBGwCAP4FHxUCBuUPBAAODPEB",
	"EAGYCQAJAAUEAAogAA8EAAACIQAAsAEBBAgAzAUBlzUA9AEAGgAFBAAAphcTEBMyABygAP4BEAVMOAH9DwA4AAAkGgABAgC4qhH7",
	"pAIBCKAA+BcJKQIADGgQ+g4iQAAKAPkFDoD2C//4/gT/DCgIAiEAAAEiAY1UDwQA8ACuBwC/AwAIAAAQAAAFDgCeAQBrAQA0iAkY",
	"GBD/mhcA4FcC5A8FwDkBNJABwA8RBFygAXLEARAAACcAAVQI0f4CAAH9/QMD/fwCBvk0MAAXGgE0OABfAFAAFQQE8NFBAAAiABpg",
	"AFcAAdgBAAECAL6+AEccgAEEAAAGBfn+DhZCBgAF9QgYUPoHAAEA/CEgBv4FOBD4kVwQ+ggsIAf9P1jUAAAI/AL0AwAN+P4G8zAI",
	"AVGEgPcAEwHvABXrSLkJHgIPBADkAYkBAJwfAA0ABgQACPYPDwQADgq2BQYEAAAbMgBWGgDZAxYEJhABSGADfAIgEP+vGQAKAAAE",
	"DAL6FwAOAAAEABAFBwQAtQEQBriqBgAYAAUoAO/CAP8TAAAWEwZZAAGA3gAjAAMIAAEACgAJAAAEAAAEDAcAICEV60gIDwQA8ASX",
	"AQ8IAAYABQAHIwoPCBgADAQAAyIEAwQAQAP9B/nWEQUrFAYEABARTKIACQAArgkARgIA/mEAMQgBMAAAGQACBAAA9gUAtQ8CWAAA",
	"EhAABVYADAADBAAEABgA/hkA/A0gC/X8JQAhAhH2ACAAJAAA884CbgYgFOwmAg8BAvUD1Q0G8QENAwgABgAIBAADsQ0GBAAAvAMA",
	"CAAEBAAEQQAACAAABAAACRAAEAADMBABFjwCbwAiEfpjugE0Bg8EAAABBZoACQAFBAAC/U8A2wEAvwUAAwoACAASCQBoIgAKCRIA",
	"KQACBABBDvQADfgHAAEEAAgAAAQAJBTuDgoPBADeANQHAL8BAIAFAIIBAAwAAAQAAuIHBgQABBAAAN0TAMMBADgAAhAAAAYAAewH",
	"ASQIALkBAEgABN0DABAAAggAAF4oEAL8rxACQcYAzykA4S0AQUABBQIBcAJQEfEK9gsbaAAhCgA3ABAEUUgAaMIAAQQALggBFhAB",
	"jAAEABgSBDXQEQBwkgAZAAPAAgJcAgAKAAACVHEI9Az0DAAG8QPCCQAF9gAADwD1ABLuE7FQFgDtGOi2CAI1OA8EAPEG4gUCBAwJ",
	"EAAQ/iMKAAwAAgQAACAAAAgABQQAAHoBDggYAhAAAbB9AMAVAA0ADAQAIAjxjQUDBDgCcwACI0QCCwgAWABgAAEG/wT8+A8QBqLY",
	"AB0AAQgCACwAAfpTEAj0tgACBgAIAAACBiH++UkAAgAIIA3zAx4UCu4FAEoUAAgADwQA/wACfgEGBAAPEAANCggYAQQ4BhAABgQA",
	"ANVhAbYJAA0ABCEAAtgBAIYHQRXrABIGEABEBhAC8Q0AIAAHBAAA7gdABv4E/wAYMgf5BQpEAQMGMgX7BvUNMgAF/AgAAhsAAgQA",
	"IAz2/hUAZyQADgABBABVEe8AEvFFKiAY6AYADwQA8QCuAwAIAAAEAALmAQYSAA8QAA0PBAAEAAcGBABQAf4BEQfCAwFzBQEUAAUE",
	"ADEVAOzPFwAMAAAEABEEPJIBNxwACBoG6gMDBABDB/sDAxdgDQQAAAAaAP8HIAf7YAIAEgAAAigx8wAOCgQCBAAPAQTwAMwHAccB",
	"A4UDAOwXAOIFALIHAdkHAhQ4EQLUBwAGAAIrIgIUDhICQCAACwAAPgAEDAAA0gMA4w8EEAAAMQAAIAAA+wkw/AD/BNAASlgAqRcA",
	"QAAAHJoQALyoMArzBLfwADACAAsmAEsEADwQABceAEwQAA0uAH2AIAAE+YkB/AMBUmJwBf4IAgADBvwvIAkAABghCvYIABAEdFwg",
	"+wAGzwIEQIAE/QAN+AAP8TNYAD4AQBPtBgJxCgAMAAl4Ag8EAP8KACUCAAgABgQAAbABDwQAFiAD/UICIAT9EXIEIQIABAAAIAQQ",
	"DZEJAK8hAAIIAx0AAE0CAAgAABm6AAgABdoPAQECAf0FAgkABAcMAwwADAQAAO0pEAXu5AANAFEF+wAR9HgcAA4AXwAAABjqPAAJ",
	"DwQA4gCRAQIIAAPAAwORAQQYAAYEAAIgAAIEAAEMAAC0AQgnAAEVAAAJAAAEADID/AXpNQGYBQArAAAIAA8EAAEEXA4CZRAAAgYA",
	"CAAAFwQBOwAFBAACAwoEwQEEADYiCff/NwEEbgH8BSEN9SoAKw/19wUpF+kQEg8EAP8PD/EDBQbzAQbWAQDqAQAIAAQEAAHwDwCH",
	"AQAZAAYxAANgAhAN8AUAtgEA6w0DRAAGTAAABAAgB/77HVEE/Af+B0YCAPpXABgAAgQAAAJ6IAAJ/jEADgAIBAAF+hEAKYYBwvQA",
	"kGwWE/YBIBHxNQIACgAPBADiANcFAI4BAAgAAOABAKhvABgAACAICAwoACK4ARCYA5IHAe8vAckdEQD7FwAgqAAYAADQAQAbAAEp",
	"GAEcUAJIhgAQjHAAAQMD/v0EwFcB3F8h/AJAAACMvGAECvUR/fo6YAAcvgAAmABJAAACCADwcwBUSAA7sAJhABEHpAgAqOQA/lUQ",
	"/gMcABcAIAAAIWpACvYACWcKUQv1AAr8KCxAAA33CfAPAAQiAWigEBILMsAN+Qb4ABcAAO0A8QrnAAB9AgJGAA8EAO0C3gsABAAA",
	"uAEE7gsABAAB2AEBBwoBCQAEBAAGIQAAqBEAuAECDAAPBAAGBtoDBUwAMAf2FZEVARAAADoCAAw+ABgABgQAAOIXAEUWAUMMAjzK",
	"ABcAAAQAAfcNEQkYAHMH/wr4AAv1JQAAGQhQDfoADfUjMgERAAQEACAT8B8aAAoAMQAc5AcADwQA8ALwAQ8EABkBsAEACQAPBAAF",
	"AMMHBAQOAhyeEQP0vQBzAwAUAAIEAIAD/QAV6wAU66YHAFZiACECADQQAOoFAA8YAAM2ACgABAQAIAX8/40zAgb4AIITAAQEAQkC",
	"AAkAUAAH/wv3/A8BDQACBAAhD/EFJgJ3JjEAAAeUAA8EAP8CBtADArgBDBAACPUBAOABAAgABQQAALsBAAgABAQABC0ABAgAARAg",
	"BiUABOsJUAAAABXrM4gDDQACBAABTFAACQAABAAA/lkA2AMACRoAEAABBAACDCgB+AEBBQABACQC/SEBABogCP0GAgUFCAMBAgA4",
	"jgAFBgIMACAc3AYADwQA4ACFAwBAAQDYBQDaAQAMAAQUAAAgAACJBQAMAAAEAAAQAAAAcAAoAAAMAAgEAAA0AA8YAAEGBAACDnBw",
	"Bf8AAgEB/Q4wA0sCBEYSgAIAAAr3DfIMiwkTBBsAAAIwAggAAP7DIAb+BLoQ+TcIMAf8/to/AANEAJggFAiwABIJOAAjAAoIAACn",
	"2AAIAAECIkAFAAAPFgIQBXEuADE2AfS4AB8AAC4QAHgAAgwADwQA8QbxAwIEAAwQAAgEAALAAQcEAAbcAwIEAAghAAIcAAAEEAAI",
	"AArZzTALAfinNQALAA4EAAABFgAIAAAPAgAvgAMMAAd+BAJnAAAASAAIACIL9WsAIAz0ACgACgAEBAAB+xMAACYSFAEEYBnnAAAW",
	"6goADwQA/xICFxoACgAMBAADtQMPBAANA7vMAQ4OABAAAwEEAT4AJQgBtDMCvgEJr1EB9wUAAAYADQAAXBwCCAACIwAE/AUPBAAD",
	"0A31DfMO8gX7EPAAD/dIJgAVAAkEAAE5EAAJAA8EAPMM8QMC9hUPBAADAcABAAkABAQAArwBAdIBAAkAAuEBA/AFAhwAAxMABq0d",
	"AQQAEQuQLQAbAAAHGgEIAAIwOAD0BRAG9iMA/gEQB13CBZQMACYAAf8TQAn9+v//GTEJAPkINBALCBwAAggQ/QAUUAAADf4OXgAB",
	"e0QAAgoV7/YDJRnrCwAPBADtAAgIAAgACAQACBQAEAL4FwAVCADDAwACGgX8LwAcCgA00AIQAAAgYAAUEAArAACpAQAQAAEYAADS",
	"U5D/BAT5APwDA/xeIAANBAAUQAAAqFIBBQr0ER0YASrQAQCQEATWiQNiAAAEAACf4AFMGiIF//t5ABUAAQQAEgbiRyAG/SGSAE3I",
	"EAb3BxEAFDrgDgAA+vIK8QAQ9QACAAZoAhATCQogD/kfGEAdAOkA28wiAAISBg8EAOsCqAMEYAME8wsMEAACeAMCBAAIDAABBAAA",
	"1gMINwIA5AsEEAADDA4AwgEADwAHBAAA9t0RFgQQAGwAAAYCAVkAATAMEQW1BREHA24gB/n0CwSSBBEDICgAAU4x9wAJCDYAKBIF",
	"AwwJBA4RDxYAERAnAgAEAFAW7gAACG0AQAAAIOARAA8EAP9OACgMAB0CAMcBAAhwAnwBAkREAAoAUBbqABXvzwcAJQAABAAAFQAP",
	"BAABAAAmAL/gAP5bACUCABQABAQAAggSAAQAAN8rAAgAEQlmBgMABgQEAABzIgFJBAANAA8EAPkBoAMFYQcE8QMABz4ACAAEEAAH",
	"egsBowcBCQAEBAAMuwEJIQARBLqLEAdFngAPAAYEAAA2AEEW6gb7ExYAEQACBAAQBHyiAgEEAQQIHf65ERIFAggA4AECAQQCBBAA",
	"/wUAADoAUQICFgACEgQAABgCDgAHACggINcGAA8EAOAAbQEA7AEAoQUAWQEADAAEFAAEIAAAGKAIwwEPBAAhAWAAAE0AABBsIwP9",
	"UrgAGgAC5AkAooBAABbsDMYBAPQPBIAAAwQAAQEOAP8rIPkF4uxwBwD9AQcC+jaoAIjmEvrIBQAClAOoABMKgwIDUAACBAAEACAR",
	"BhBYACkGEQf8JwD+BQcoBg8EAPIGAQQCBAAMEAAIBAACwAEHBAAAywMACAAEBAAKIQARAgkgA6EBCisAMAr2D0CoAAsADQQAAP1T",
	"AL0PAAwAACcIA1QAClwAAQAUAhMABAQQIg3zaBAkD/HwAwEEECIU9AEeABEAXwAAABnnAQL8DwQABg8EEC0A2TMAlfIA3eMDMQAB",
	"UQABYgIHvGUCvgELJQ4AASIFgAABMgAACQAB0QEwCfcH+DUAEAAPBAAAAlwSIwX78B8AThoACAACBAAAAQQACAAPBAD5BV0BAwQA",
	"BHILDwQAAQSRAQUEAAK0AQYQAgIhAAAEBgAIAAC+AwVeAAIrAAMEAAA6nBEDGVYA1xEABQwECAAiBv+0KQEHEgArAAWDMgJcAAQE",
	"AAD8KyEC+f+BQAsC+P8ADDEN/PpkABEPBgBQAAAS//QwAgD1DwkBBA8EEuYAlwcEVwEHpAEFBAAGqgcCEAgBGCAA0V8AyQEAIDgB",
	"KAgCDTgAGwAAkQEBQygB8MEBEDgAGwABsAETAqyNZvsAAgb9/wQQwAEAAQMB/P8DA/0M+kNsAFMAEALZOwBXBAABAgA9AAK8FwEA",
	"IAAAHgAcAgH5BwIDJiEDAPhPABweAgA4MPwEAwUKAAsAAQQAsPsLAPAAEfgAB/QGGQAQFgsE4xH4CPcAACAA6AAADgIAIQYPBADs",
	"ArgDBgEEDxAAAwh4AwgMAAEEAADUSwALAgAMAAAEAADCAQI3AA8EAAshBg4PNgFQAABAAAALBBADVvgCAAwA/wUB2wEABAAEkgQA",
	"JAAACAARBv4LAuYvEAcCWgHUCSAM/CEwQPwADvr/HREQEQIAABgACABBAAAX8TdqAg0AAR5OAgkADwQA/0QDAgIA6kkAyyEABBAC",
	"EgADzQUC8UEgE+z+AQDdAwAcBgcAUAA42AABBDAABf1QMgD+URD++QMhCPgYBAAjABAKOwAA/w0ADQAAFwQBEAAJBAADAggA/SkJ",
	"/i8gJd8GAA8EAPICqAEH8QMABQAOAQQABQAPBAAFAcIDAAkADwQACAAVBAAIAAkEADAYA+0LagALAA8EAAMNABACBAAA6lkBAQQB",
	"BQAA6w8S9f4zAQYEAgJIBv8fBQQABg4CAf4DBCMMDwQA4gDmBwBdAQXoAQ8EAAQEKAABHDAAEQAPBAAQAMsDASEIAA0AAPhzAN9p",
	"AA7AAEkAAFMCABwAYf8DAATx//uPAPMjAsIxEAWsVwACUhEAABYAAx4Q/mS6EAcRqBMDACAXBscFBAkAEwtbAEAM+QP8PmYA/BuR",
	"AAYABhfvABPwSRgAM5Yh7wkEEFMAAAAr2RQADwQA8Q/AAxEHBAACwAUIBAAPQQAOAhICCQQAAFkCRA8E9QrJrwQjAAH+EQUEABEH",
	"gAoACgAEBAAHCRoCdwAE/C0PBAADAgIUA00CAwQAECQFJA/+A+oPBAAJDPQPDxNGIATMAQEEAALZKwQ2AAkbADAAAAzKewILAAQi",
	"AAAmDAAIAAa0AQw8BgICCAT8BQQEACIL9f4FAAAgAAgABQEGIBPzSgAA/zcWGgEGDwcQ/wIPBAALAgkICAQADhIADsIRAwQAIAT6",
	"GQAJMQAADQBCD/IACsgNBjoACgEEBgQAEAgCXgDnCQUBBBIHACAACwANBAAL3wMEAwYPBADyAFMFBNMDAIcFAXURAFoHAPoNAABo",
	"APEvAwIKASwAEgIs0AAQAAArAAARBAH0DwAMBAAVAAL8LwErChD+MQAxAAT8QFgR/jwIEALWESACAhhIEP818AFA4gF4AHIA/BMF",
	"/fQIxlMAFQgBCAAQAgMwAAJyIQAGPwACiQAAK7YDCAACLwAFBAAQCl0mAAZSAC8iEA0YhAJDAlAP+gAK7vkBwBTsB/IHABgA8wAd",
	"4ylkAB0APxAAEAIQ9A8EABQEnQUPBAAgBjsAA1UCBewDAB8uAZ4dA+lTAAoKAggABAQAAAYGADYSAPcHIgYB9z0AAAYAAEADMwAP",
	"BAALAgEIChIeAAEIIDDQCgAPBADyALgDDvQRBxAAAAUADgQACBBAABcEBDkADwQAADAD/QfcIQALAAYEAAADBEQHEwHs+QcCIngA",
	"LQQADgAGBAAE/BEOBAAxB/z8AQYwB/v97h1wAAgB+wAN85ASBOENHxIbCggPBAD/HQKlAQIEAAgMAA8EAAIC4QMEQwIDLwAANNQC",
	"CgAFBAAAAQQACAAJBAAwB/8E92cAtzEQB/59AgAiQfsD/wVfFgJsAgAJBAAIAA8EAAEDBDYCBABDEvEAFGMIQQAAHeUIAC8k5gEE",
	"8QCBAwBcAwOmARsCvwMAwgcACAAFmQcOBAAGFhAC4wEIPhgCIQgArQGgAvwBAQAF/f79/kWwARQIAFzIATheUAv59/nyK5gB+zsQ",
	"/QG8AQBeCAQAQAX9Av0IqgAIAAABBiAG/Za+AOsVIAYGBB4RBwBAUAAACPQJTypIAAnyCjFCBVAAAAAuA28KECoBFDEQBAB8Bg8E",
	"APYEAQIIxQEABAACGAAI+A8A1wEACAAPBAAGAoUFAwQAAg4EEAT4CQAJAAwEAALLAwAFFgAIAAEEAAAEEgMEfAD6BwASCgEHOALa",
	"CQCSsAIIAAcEAAAAJAD2AQABSABwAAABBgEpDhgA9SsGCgBDAAAQ9H0IDwQA/1AA51sAnQEBuPQAEQAAFjABYRwgABSUKwATAAAG",
	"WgC5AQEMAAkEAAADAgj0FRAJ2AEAAgoAIAIAIQAPBAAKABNqAAgADAQADwEG7w0EAALpAw/JCQgPBAAHAgEGDwQADA8lAABRFOwA",
	"CPfqAwTcAwMAKAILAA8EABAgCv4CIEIAAAz6/FEcDUUCBeUDEBkfAAAxCgP+BwYcHA8EAO4DmgEB+QEAAEAAxDcBwQcAFgAAE04A",
	"L3IADBABEAACrhEAvwMANwAMLwYBBAACMEAA7AcAxhcAFdwxA/oDv4cLJghABwcHCZgBABhGCboBQAf5AAJs7mAI/AAFAvsvbAIY",
	"7hAJHHhA/QAACQBuAIgAAC0ABAgAAkgOsA/xBfsAEPoAEu4NhaAAEhoQ+AswVBwA8yDgLnoxACDnBwAPBAD/KwExAgAJAA8EABUE",
	"MQABAB4BCAIUCakVAlYCAAoAAA8EAAgADgQAA6gCAzMOANgpEvz+AwIPAA8EAP8oBFEBCAQAAa4DAAkADwQAEQJBAATfAQTVDwND",
	"ADAE+wLHPwDJBwAPAAgEAGAN9RAAAPNRCgACCgAIAAD/BQAKAjMH/wX1cQR7CgJUAA8EAAAjCwQAJjH9+/v+HTD99vvwRxMS5BNA",
	"FvII+AsUAAwABwQADwEG+A8EAAsCHGwACgAEBAAAoQEACAAPBAAUANgBAAgAD1wIAAG8lQAJAA8EAAISA/FBAQMQEP8gFAAEFAKN",
	"AAAAKAAIAA8EAAlwDAD5BgAU+AwSAA8ABgA0AAEIHycGHucAvAcAmwMBggUABAAB8QcH8gcABQADFBQAAGgAqFcC3icAoBsFNgAB",
	"5x8BOgACKFwAPzAB+AcAKgAADDgAQQAAEAAAOUgA5pkAYOAAYAgA7AXAAQACAQL9AAMEAPsI4LUAVFQCyg8QACy8AAkAAv8DDwQA",
	"AAGZzgACLjAAB/UAJgI0qABZ0ABviAAiAAAAXGANAPf6BvEdNDMHAAi+AAK0xoAAADAA0BLZE266EuYXAA8EAP8LArYDAngDAgQA",
	"DwEEAgcZAgHsNQI3AAEEABIBDz4IQwACBAA1BxQAiBEAYLQACAAgBQREXgDpFyAF/TkGAFwCABgABEcEBAgACgQAQAz+AA3fEQD+",
	"KyQK9gQUERMfCAb/K1Ag7/QADwkADwQA/1sCLwIAAHwEzAEC6gMCGAAC/z8EAFIPBAABAAgoAD8IAAQWAfaNIwb6+nkC/EMBACYA",
	"CQAPBAABCPYRCAQAIDvFBgAPBADyAqoDAvEFAAQADxAAAw8EAAoO2wMJBAAFgngPBAABArgzAQQAEASUBQAJAA8EABIBzw8EAgxU",
	"DPQADvIUJgIEAAvjCQH+BwIpIg8EAPoEfwEAwQUArAcMAEgAGAADo0EADwAAKQgA1wcBDAAPBAAFAC0ABCUAEAJRAFAB/QEBASJ4",
	"ABIAAQQAAE2gkAAH+Pn87AMF+WQAAgEEAPkFAA0OEAb7iRAABWwxBfgDACgAKZgACAAgAAc4dhIKTmIAMwAJBAAxD/ELSkgjAO4N",
	"AhIWYhACBAAACBgACAAABAAYExkADwQA/04BAQgAAYoADQAAAgoAPgoCDAAB0xU0AAX7/7MNBAADAmgAcyIDMgYAYAgA/xkADAAP",
	"BAAlDwEG+AQEAA/pBRAPBAAFAPEDAAgADwQAAgTpBwslAABvAFAUAAD9+uWHABEAAwQABAMSAABAAAgADwQACxML/HUgDPr+YQAS",
	"AAIEAB0SFggCAQYACgAPBAD/DQ8IKgAJEAABwAMCCQAPBAAFCkEAAgQAAwcCAwcADwQABQUCXANCAAD8GwAIAAaCBhEDAoYACgAP",
	"BAABEg8CjAALAAH/RTYAF+kBDAQBBiEw4gw4AAsADwQA4gCcBwNoAQEEAAEQAAAZYBAAtq8AEgAB3w8CCQADBAAAJAAPCAABAbwH",
	"ACYCAwgADwQAAREBtg9w+wL+AgEA/SEoAewHAAQAQgcGBwm1Ox/6phMAAmQABALYBgMCAgcAAAKMAAgABpACBAgAAFMMAAgAEw1M",
	"rCAR+C0KECB2PgIjPEIAAAAnESIPBAD3D24lBw8EAAYAwwUACAAEmgEGEAAJBAAElwELBAABLgAAoxEBbQwG/gcCtAEACEQCCAAP",
	"BAAHACoAAABMAChqCQFmBf8nBQQAALfoAAgADwQA/xIO9BUPBAAeAkEAAeIBAQYcAA4ADwQAAUAN9BAEt4sADAAAYBQAVJACCAAA",
	"3AEA8w8Giw4CVAAPBAAIEA7xY1AP8QAQAhIIQgAAE/3tAyYXCP8vBwQAAw0GDwQA/xAOEAIP0gMEDwQAByIC/sq3AAwACQQADr6D",
	"CwQAADYAIgYCCE4ADHoE/lMABBgDGQIPBAAJGAcARDMAACUXGlMAAAAzzQkADwQA5wS8BwL7BQJoAwEAUAC0NwAceAPoBwDohxD+",
	"wj8AhQ0DGDgALAAAJQgAkRUAFdAB8y8gAQDVFwHtDQRcAAD/DwDgFwAEGED//AH9EcgA/msABwgA++9SBAD7CfiBAAQDBhACE3gD",
	"ewAAEAANBAABhdwA/jkhAAQEGDUACAMlDggEAED5Bw/q+QUjCe8OEAAQIL8AAADxO8UAFBrNGQAY/xIABAACyAUDdQEPBAAHBPMB",
	"AAQAAqQPBAQAADAEDz8AA1ADABQA6wkAAf8PAAQAAOsbEv8JAAMEAAQIAgBrAgAIAA8EAAMAAyQhCgIFHjAADAIDIgDlJxIWCwYP",
	"BAD/PgDRAQAIAA8EAAwCOQIBBAAA5ysARAQADAAFBABGBPwEFJIFDAQAIQX9/R0ABvoTAAEGARsKIAP+Ag4A0wsADgAPBAAORRfp",
	"ABodCh8qBE7lDwQAbAQcBATEAwDjCQAIAA4EAAEDFgAJAA8EAAEA/k0DA2oADwAkC/nXNQ8EABwA/xMgTbMKAA8EAPEDrAUMAFIE",
	"eAUEEAAPBAAKDxIEAQA2AADoBwJACADKCwBkuAAaAAEEALH+Av8DAAz89/j9+0qwEADWLwA0AAAdAAAAhDEH/gWUAAEAMADQXwP8",
	"CQUEABD1RwLRDPQJAP4E/gAN8wkA/gcoMQvvDkhKACMAADk6AwgAAQQAAx4SAAECUAAgAAAAFhQAEQAPBAD/HQ/vAQEJBAALqgEA",
	"OgoAEgAGVAIHBAAeBL4JANkBAAgAAL8BACckBBEIBdQxDwQAB0AP8QARawBBEvIAFKYAIw/6AGgA/zcFHxQPBAD/IAS8BQ8EACAB",
	"MbABChAPSwQCBwBIDwQAAgEAMAcAVhAKIFQAAQwAEAAAIQAPBAAXAQcYAAkADwQA/AqwAw+mAQIPBAA6EAQVBgFnABAVmBUAAxYA",
	"uEUR+gISAP0RACUADwQACgUGCBAM/TkACQAPBAAcIE2gBgAPBAD0IP8C/BcC2DcArQkIEAIAEAAACAAEBAAAJAAACAAC1gcACgAB",
	"2wMDCQADBAAAFYYDLBAAzT8wA/0E2yUAHYgAHgACfeAACgBRFOD8DOsNACIF+vwJAgYABgxIIgj9ADAxCAD9GUBACf/9B/zPAQRo",
	"BIkG0AX/AA3+AA/xBvoAD/4CLDEAABM2BAAKYhTnFGIAqNYAqtYCDAAPDAT/Bg4EAAwUHA7vAQ8EAA4BIYgAvCEMPAAhEPPG0QAL",
	"AA8EAAgBgAAEQiYPigYQAkUCBQAmHBwDFiY74xMsDwQA/1ggBfs0FAAKAAcEABENqR0PBAAUAQgCAAkAARwEBAAmDwQAFAABCgAA",
	"LgAMAFMAAABAwAkADwQA/ycE6KMABAAK1gMPBAATAj4AALwrAhkMArYDD7lxGQAXEgAAMi7/+0UMDwQA/woAcAEAvgcAegcABAAI",
	"cQEADAABFzAAu1cDiRcBkE0AMQAAHxAAJQACCAABigUAGwAECAAAIwAAUAAAFB4CTggAGgAAFEBA/gEG/ACuIAAADiggAgJO0AAc",
	"ACIHB3R4AQQAIgICxwESAwgAEAc/NAQ8DgARAAUEABr9bgIBP6hADvIACjZQcBDwAAsF8/oAFgA3FBD4/AcCLgokJCFxLg8EAP8j",
	"AqgZAgQAD+8DEgAqggAIAAD0BwDEAQDqlQIQAAcEADUIEPCXIQkEAAAANAASBAAlIAADhgYIAgQIAA8EAA6xFv0A+AgAGfoAFuoB",
	"AgsEAA8BCP9cAwcqAAUABzEMTwn4ABACCBMA7AUACAIAzAMA2nMA/EsAGAAAPQ4HmgIPBAAMBwEIDwQA/wkCmgcPBAAQDykAFg8E",
	"AAIAPgAA3wMB/kkE3RMECAAPBAASVQj8/AAMhAAABFYACAAPBAAPL0y0AQr6EQIC+ALxBwCPBwAJAARW/AAEAADUBwRmAQAgAAPF",
	"AwEGCAAcAAHlXwASAAANAAAIAAMEAAA0AACcBwDDFxL99wcAoJ8BJgABMAhz/QD/FADsCZ4FEwT8HwEmPgNTCAAQAA0EABX8YqIA",
	"LMoAFxRQAPsADv/pd0D6ABD+SzwAHQBBABD5CBVKIAoACiABEwAjAA95Nh8fAg7/GQCpAwDCGQAMAA8EABQAJwICNwADBAAB8gUH",
	"8TMDBAARA7I9AAoACAQAAgI6QAX+Bv38HQBMAAAQAAQIAA8EAA9TDfP/ABRGAg8EAP9DAc4BAAkADwQAFQDMAwDCEQrEAQAF7gAI",
	"AA8EAA0A+QcADEgACAABLgZfB/kAC/kEQhQnHePqAx8w9gX3DwQAWQ20CwAXBgAIAAYEAA/5BxUZCvgBHwuJAh0GBAAgX6EGAA8E",
	"APEDKgUF8QcAgGcACAAEBAACsM8PBAALBOIBAOEDAwsABQQAIAIAGJwQAxJQChsAoP4DAAz2+v37AAT8TQKoXwHcEwT4gwIJBgT8",
	"HxMH+qUKBAAxDAD7SARRDwD68QUsHjEM7gcMIAAMAAEvQAMJAAAEABAQBQBAAEwA0wcqQQAATYAQAA8EAP8DALQFAAgADwQiEgwE",
	"AA8iBgQAHwIACAAPBAAEAgEKAAq8AwgAAAcQAAsADwQAEwH/XSwS7gEwDwQA/zUGEAIPBAAeABRwDxECAw8EAAcA8QcBCAAS+P/z",
	"AAwADyY+GSMV6wAuIxP8AQgB/g8LHD4PBAD/JQ7ABw8EABICAMwACgAFBAAhFvD0MQALAA8EAAsEAJIBBQACMjYPRkgLDwQAAgD4",
	"JQAIAA8EAP8CAcW5AdYPArwfABQAAAQAALEPBBAAAAgAAAQAABQAABAADwQACQAAMAAIAABfOFf+AAEF/AAOASAGkgL+AAXrBAMF",
	"BAUkMA35+vmnBiUABAQAEf0EIDAJAP36EyAACifwEPgFAAAcAA8EAChPMwAAfwAI+wMBAg8EACEPmwkBDwQAFwOhEQDyFwAIAA8E",
	"AB0PRBgDDwQADCBfxwYADwQA/wMOAGgPBABGOxUBAI9DJAf+AEAECAAPBAAWAgEKMPkAElMAHxUeBh8PBAD/OQHhBQAJAAQEAA0R",
	"AAUEAB8IGgADBvwLBFwEBAgADwQAFgIBCgL+CQQEAA8BCvMAzQsI4wMDWwEJ1wcEDQACLAACIhgAFAAABAADMAAPBAAOBFEGEAX8",
	"dy/8/sALAFH8A/8G+/whEPkKcAAJAAcEAAALUgEIAAhwAABHngAHFAdKHAI6DgFCKgEJAAFHEAAPUBH4QSwCB1oAIbIw9QATABgA",
	"JABCAADNgQgADwQA/1kAPQIACAAEuQECxEUBCgAPBAARBHgCAj8ADzwAGwEBXAH+MT8AAGABLPkPBAAoDzIKKADjGwGDBAAEJgAI",
	"AAa+Aw8EABcBJxQACQAPBAAgIGaaBgAPBAD0D/EJLgKaAw8QAgcFXxYMBAAQDJsFALkVBLQFDwQAHWEO9wAOBPb/aQAPAA8EAP8b",
	"Ao8FAAAwAog3AA4AAMMBAAQoBPAHABQAAMJPDL0VABgIAAgABBgAAEeoADEAAtARABXKAAgABAQAACegIAT8HYAAXFgAEgACBAAk",
	"BAAEKED5AAACCAIA2/kCEwAP3gMOAmsAIAAAARgACgAQCkkOaRPtAA0G6/+FAAQAEQ4AWAAKAA8EAP8WD7MDBg8EABcPEAQHDwQA",
	"DwD+AREFVwQBBQAMBgoPBAALAiIUIhcG/S8RIC8IDwQA/yoAIAYIEAIPiwEYAQQAMgT9/65bAA0ACgQAHxCSDQwACAIKGggC/gkP",
	"BAAUEAn/FwAKdAANAA8EAP9wAEkCAAgABAQATwn38xJMAhMAyg0AJAgBAhgAEQAPBAAuEDMFAA8EAPYgAQEGWAFhIwGqAwHZXwMA",
	"iAD+lwQQAAIEAAP+BwgTAAAvCBL/PBgDHgABBAACzAcAVUgAYkgg/gJreAO6DwAnACIGAwiIAiUAAgQAAB7gAL2XBDsADQQAIQcA",
	"/GMEOxICNwgAQEYCCAALaBAABjAACAAA8z9PO8UUGgEO/wACqAcI4QUPBABfANwDCAgADwQAEi8IBAM8JA8BDv0KBAAK1wMPBAAS",
	"AhIIAkkCDwQABwSyCwwEAALCAwkcdgD4BwAIAA8EABI/CgT7AQ7/Iw8EAFgB8gUACQAKBAAK5AUCJQAGB5APBAAdMgsF+gGqHQAB",
	"Dg8EAP8KAAIwAAgABAQAAwAEAas/AKEBAvwHBiAIAB0ABAQAAKwBAMkHAAwAAwMIAAsAAcoBAA4EADQAAAgAAxUAAC8AAAsAAQQA",
	"bgH8Af8J+y6aARxkAAKMAQ0ADXMADwQADxIOIKAwEfgTfKoAKLQQDvY9AAMkABgAAAQADwAg/wAPBAAHAtcFDyAIKgAHAgAIAAwE",
	"AA/cAQsACVYGCQYPLAALDwQA/4sBDwQACQAPxAEjAAwyAAEOAAwABHA0DwQAGQAAQAAIAA8EAP9rD/sBAAAYpAAIAA8EABUTBwja",
	"AAwADwQA/0kA7wUPsQUFAgQAJAH9zgEG/AcPBAADAEwAAAgAMAD//xegBA8AIQT8cGhwAwAN/Pn5BhoID/kNCiAGAAxIEfkCWEIH",
	"AP8KUAQxDPQIBBAhCfIf+AATAA8EAAEg6xUGAFQAAADw7AJyEGAFADAAgH+yCAELAA8EAP9jAlgIDwQAJAH6sQAJAAEEAAD7GQAI",
	"AA8EAP8kAu0DD8sDDQ8EADEPZABAAACCAAgADwQAHRCZBQAPBAD/BA+ZAyAEEAYPBAAGAs81DwQABQAENg8BBgkPBAAQDwES/ygC",
	"2g8ACgAPBAADAAQ4DyIACwYEAAzhAwA4AAJOAgASWAAIAAoEADQBAQLQC0IHAAAEChQABnwBAG4ENQIy+v0MIjgFBAAT/D9CAN0P",
	"AwgAAN83AfwXUA3sDQcAAcAADQAkAAD/B3EAEBQAANkZCwAPBAD/TwTVAQ8EAB4AAOYDahAmCADlAQ8EABdAE/MAFAgAAOxrAwgA",
	"DwQA/yQGywMAxQMACAAPBABXAwgEDwQA/3sGEAIPBAD/yQN7BQUEAAC8BwP/AwLrlw8EABgDOAAGBAAeBOwXIAv8O9AACgACBAAQ",
	"/hFmEAJ4IAQDBGEIAAD3AwMEoDD2APoHqDEK9f3cTwAeAAwEAED6AAANCAAAHg4DPQYFABAwAAAAAS4fzfoh+w8EAFIF/jkNFAIP",
	"BAARAi14AAQAAeAJDwQAHEAVAAAkCAAPBAD/Lgj/Aw/vDQ4PBACFEDsFAA8EAP9kDzQCLwIAggAEAAPbBQ8EAP9UACAQBLgFAMgF",
	"NQEAAAAYDwQAFgHWJwAJAAUEAAMUYAUAEA8EAAcT/fcFEP3ZLQfrFQLZhxHz8QcPBAAKFdwBBjDFO+cCKGDAQABnmX8RAA8EAP8k",
	"Dc0BDwQADgg+BgAMIgMIAAAEAArgLQ8EABAVCwgEDwQA/7QD3wMPBAD/3Qx3Jg8EAE4QMAB+AAkADwQA/wkApwUMBBAMBAADBAgA",
	"CwAPBAAWD+sBDx/5/S0XEfwMSAAKAAAEAAT/BxDwARgACQAPBAAQEEAFAA8EAP98IAf53gkACgAPBAD///9kD9ELHw8EACIP7A0M",
	"DwIEThY7AEYPBADrAOgHAAgADwQAWwY4KAQEABIBt1cABAAABeIPAQIeB1ECD/8HGA8EAP///////////////////5IfB9hfMA8E",
	"AP///ygNmRMPBABiDwMaTiDFJwYADwQA///yAOQfDwQYAQAYAAAIAA8EAD0CREgASjgADgAGBABE//z9/cwvD/4fFAkEAC/8BAAo",
	"EQ8EAP///4UW/yaCDwQAU1TQMAAA2Rw6DwQA/3of+gEq/5gPsgMnGf3JTyH8BBEIAF5oH/z/LRYiA/kiEGT5/QAHAPgdPg//BxpC",
	"OwAZzQNAP5kAgQEw/ykPBAByEvQBMg8EAP+VD2MQLxX2QgAP3b8BDwQA/1oPzAEvDwQAZB/FATr/HQOlBwAEAA8AQB4HKDAC52cA",
	"GvwDEQAEBABG9fz6+6anAwQAYP4AAgMA+wpAAA4AI/gCAEgAUAAAQUBH/wcEAwBIDwQAAg8eAAQAAm4P/z//YQ8EACkAykEACAAP",
	"BAD//yIS5+oLDwQA/y8PqBFcIgAAzb0DDAAPBAD/TwjYBwAMAACubwAMAAQEAA+pOSET/JkvALQHAAgAPwAA/1sYAjD///7DVwAL",
	"AAEA1nAC+QIA/gX7hwBSAPgI+/3IBwQAWAAMAA0EAAQAGAEAOLQGAO0GAAAG+A8A6QJQBQBIEPD9MT/nAAAWBP8VD/AJHg8EADoR",
	"+DIKDwQAGyDvEQYADwQA/zAGtQMPBAAWDxEODgLTAw8EAAUg/ASv0wAKAA8EACYP/1X/JwTgBw/wA1EPZAALDwEeIQBCghDy32UB",
	"DQAPEhQYH2cBWv8HAQ4CDwQAFADVBwjUAQwQAAAEAAD+v1IAAQEC/wUgABMAAQQAkP8AAPz2/P4A+hl4IPkACAADBHgMBAACABBE",
	"BAD8/QBQcQ8A+AD8APg8EED3Bfv7Fkgf9UlGDAEAWAAJAAMEAB+AAWj/Fg8EAD8E9AkPBAAiBgOUDwQAHgAAUh/mAAr/FQ8EADwv",
	"/fzcAwMPBAAYACAGAQB2Q/gAAPRhDA8EAP9jAIYVAAgADwQAFADtZQAIAA44TgDlXQAIAA8EAAsA1wUG/10CTBYPBAAWMOsAAAD0",
	"AAsADwQA/wUMlicADwAEqQcA6gED/6UBEwAAEAAdA+IHDwQAAwQOcDD/A/1TgAC0RwU5AAQY5ED0//39pm8ADAANBAAAKfAG/xUF",
	"PAIQBAgEAAkADwQADLDv9+0AEwD1AAkA8yIKAQqKc+0iABoAAKACaA8EAP8UA6sBDwQAGQLgBw85ACABBAACFgQEMg4BCuIACQAP",
	"BAAWH/IGDBcPBAD/VgIRAg0EAABPBAAIAAIEACD8AAYQFPvoAw8EAB5D9QoAAP91BWXoDwQA/yEDDxAABQAPBAAVAMgBAjcADwQA",
	"CRD8BH4ACQALBAAR+84hCSMCBvcFDwQAED/2CQDd9RoP/337AaYHBJwPAMkBAAkAAw8AAbQnANQPACaIAhIAAAQAEf4YAADCbwAO",
	"AAgEAAesBQBXAAHdfwAsADEC/f4LmAA5+AAQAAAhAFMAAAD8/RNgD9MHFAoEAAAGJAb/fQQ0Gg9OKgUBAHgi7OYAGD/NmgAAkP8w",
	"AeIBDwQAIQHrAwAMFADaCwAMAA8EABoa+QIMBACKDwQAEAD/DwAIAA8EAP9mAP4DAAgABAQAT/cAAO6c4RMA/w01+f0D/9tC9AAA",
	"9BwcDwQAJRDNCFwACQAPBAD/FAAFBgAIAAAEAAKzBQ8EABdB/AAA/Um2AA0ACgQAD7cHDQAICBX6+g0ABAABPAQPBAAVEPf2hRbo",
	"JAYPBAD6AL8FAAQAANwHABAAAAQAAOQHIgEBzO8AEAAA4M8AFAAADAAABAAIigEIBAAAzQUASQgAGwIAkAUKVBAATpABCAAEVwAD",
	"BABC/P0E+lIAEwe47wB5CgISACAA/UwAAApoAQ4AAUoIAQkADAQAA/cHBC8oACkgAQAOMekM+FsEIOAcBgAQAP4HAQkADwQA/w4v",
	"/wFrAQYPBAAVD6QDARD8ABIACQAPBAAGAgcME/n9IwD6AwAIAA8EABZA8Qn6Cv8NEO0/AAv/DQAAEgAIAA8EAP8EDJcHDwQAHgIx",
	"AgnzAwkEAAPbAwElBAAJAAUEAAHEmSH7BvgPAAsADwQAHn/yBQDyCPsJ/w0aDwQA/zYP8AEHDgQADhIEAhQCAQnyAAkADwCeAA8E",
	"AA0h+PwxBA8EACIP/ovpAnoBBgQAAQTIAK3XAA0AAwQAANwBBBYEAACYBAwAAMgBAOAHAEQAABQAACgAACBoABwADwQACYD9AAP7",
	"Af///qHPE/1cEH8AAP0FAfoOrw8EAB4AAAgAIAP30AU1AAAD/jMCA7gBOwQJBAAEQgIETBAS7zR4UCDvAAAO/wcg8MUfBhMA+Q8f",
	"MwCI/xUOoZEMEAAPBAANEfxKigrVFwMEAAKilw8EAAdD+AgA94AAA/oNAiQWAAoADwQAFRHgBgoPBAD/WgGgAw8EABBA7/IA+E0E",
	"AAwACgQAEvj0Aw8EACkCAgoB9RsFBAAEHRgPBAD/Ch//DwovDwQAAwQTLg8EAAsT+SEEBAgADwQAFgD/qQAIABDuOwIT6xQuDwQA",
	"/xMAwAcAn28A1AcABAAAFAAEBAAMELgPGwIBAa3XAAkABwQAAAAQACwAagIAAPwAAREEAsAHAP4XQff1+wQAqBD5HAJg/v0A/gAC",
	"aI4c+P0BEffSD2AAAPYNBPV8GBD24AFw/AAA9AcA8ui/EPEIKB/7RAoCEOBo0gkADlQfAACh8wcIDwQA/1QGAiQA9wEAU6oEaQIB",
	"wikA/SkADQAPBAAQAf0nAwwIDwQA/1gAHwQACAAABAAPyAUTDAQAK/sDSgQCBAAPTQATE/f48wEFABD57CskAPUODA8EABcg4CUG",
	"AA8EAP9eSPwAAPv+Aw8EABlj+AAA9wD66BkQ+ioEAAkADwQADxTrACIU7fwLAf4VD/8J/wEIaQcADAAN8AcU/8YnDwQADwQHCATf",
	"BwA4ADD+AAL3zzAB/wDy/wAWAAEEAJIC/gL7APb09PK2FyAH+f+rUwID+QL++D9A+QD7/QgAE/r4/xP5CAAPBAAFv/YA+/oOAPQA",
	"/wD5HIAGIgATAMgADAA/zQAACervAAQAArYjBI4HBNMhCPAFDwQADgT4AQ8EAAcEEgIPBAAFA7IRAwcAAP2hAQgADwQADgQEEgT8",
	"Cw8EAP+CDR4CCvMHAQAKLwAAuwsCDAQAIvYD/wkCBAAR9f4VD/65IR8A/8X2DwQAIA/MAw0NBAAATAQOxCsy+wD8AewPBAAMIvr9",
	"Dw4ACABAAAD9Av4TKPUECAIPBAAIGO3p5QEDCA8EAP8SBAsYAboDARAGBh8GBgQADCoIBQ4AAa4hAUEAAwQAYP////7+/AneIAEB",
	"/AMATgCQ/wQA+gjr9Pf/yNFA+gYA+sYPAC0AAiEWEfvvBxD48AEADwARAAwIAAoABvwvAgkAQ/gF9/scEAIEACHz+isAsvD4+AAL",
	"APYABQD2EYgAAJgBAAowtAAfBwAPBAD0BbYBDwQABA8gAA0Azw8A1AELDQIPBAAAAPYBAAgABQQAAsEBAgQAEvz42REAJiQP/RUa",
	"4vf7AADyDQAA9voAAPAO/QEg7BIGAA8EAP8ZBpwBD8cBDgQEAA8pABUBRQQNBAAGPgAQ/fg7AAkABggADwQADVD1AAD4Ch8iFfTq",
	"Cw8EKhgP/wf/LQ8EACAc/P4TAAcAXwD3+uvt/xsNAgQAAOsBAP8HAP4RH/l/CB4EBAAD/wcQtAUADwQA7waBAwDzDQLkDwAGBFMB",
	"AP0AAq8nAKOfAgwmAsABAQsAEPwwACAA/nADACYAALAFAAgAABsAAEQAAioAAhwIADAAAEQAQAAE+wLtBQAWABL+cA4ACAIR/SkI",
	"AODvAxokEQbgCQEfAED+/f4Cwt0B+AEPBCgABQkAAwQABADaBADYkuoE+AD4C+cTAP/dINz2DEgT8f0PF+EVCg8EAPwC7R8E0QEP",
	"BAAYA3gBCKQBAwQAARAAAt4HDAQAAZwBAvgFACEABAgABv0bATwADwQADkDyAADxPa5A8AAA7zgKA+cBAAQAVOQVAAD1AAoPBAD/",
	"OBH+4AMACgAG0AUPBAADD8IBAwE+ABD1ly0CawIA7QsACAAD4O8PBAAQMPj8BNgbEPNZ2AAQAA8EAP+PBfgFBAQABLwTDwQAEwRI",
	"AgJuAg/+DxMFBAAAAEAD/wcABAAPCNrpAnADBgQAANwnAY4DBwQAAa8lAAkAAw8GAQsAA9TvABAADEQADAQAACgAAAgAACiQdf4A",
	"/AD9AP1TIgDeHwIMAEAF+wH64a0wAPsG/RcAEwACBAACDCBjAAD4BQD6iDACCAAA/BESBe45BXYEBPkLBEIEdfoAAO0KAOoQLARk",
	"EhPwIjogxR4GAB8gAgj/BQrwAQ8EABIEiQEEBAAOQQAQ/QPaAAkACQQAB6UHAwQABMMBD+EnHSLzCwAYOvENAFAMEOcFAAUEAAH/",
	"AQ8EAP4OrwEPBABLQvwCAP5QRCLr7ecBI/sAAPQP+AEUAzUKAfwjAEIIAg0ADwQAGB+zEAr/QA8EAAUT/dELEfw8BgAKAAsEAA/y",
	"AQsBvy1AAAAA9/4FUgAAAPYD4BMBAP4ACQAPBAAXD/AF/wIbApYBAKAPAAgABAQAAxAABKcPABUYDO4FDQQAAFAEATYAATAIEAL6",
	"OSQA/l1AAgQAEAIQKJH39PXz/QD7Av3uHwAXAAEEBAEIVMD5Bfv/BQD4APsH+/3oZ38CA/z9CwD38l8MUPEA9QACJCIBAPhhAAAA",
	"8QkA//0D/0kGAPgPDAL2AqkBBs8JAxAAA24DAMEBAggADwQACA8RAgsPHgALAgQAASEEBgQABPsPDwQADgRADB7z8EcQ7ApaAAkA",
	"DwQA/28E9g0T/bIFCgRQBBgmAPkRAf8DDwQABRD9CCYCAygCBAAR9fIBFfMAGB/2HAQLCAQAELMFAA8EAP8lD9ADEQoEAFn7AAD8",
	"/wAYAPsVMwD87BECDwQAAFH7Avv9AvQfBABOAhwCIP0BJSIv9gD8HxRF8QAA5hBcFdYKAA8EAPAC5wUPBAAFAg8GAAYAAAhAAMT/",
	"ABAAANgHBpoFAigOA9YBAScIAxAAAegPBD+yRAH9Av2wHwAgAAAIAAAGYIEBAwD6B/D093hAYPsI/PoBAdW7Mvv+Ad9vAwQAARQY",
	"AFEWAwgAFABMAAIVAuEAAPcE/PsH8wAA9/v2AN0HABJEge4ABP358QADJAAQ9zaoATMAEOEFAIEAxQDsBADn5gwADwQA7wKnAQDq",
	"AQAIAA/vBxICBAAGKQAB8AEACQAPBAADBPYBBAQAAQkEAD4AIPjssAEj/gH0Pwb/JQXjAQ8EAAAAAEYACAABKA4AAC4R+C8WBEMA",
	"DwQADw//R/8cDghCD/8FHAA/ABH5qhMACgAAEgAEBAAAogsPqOkLAL4DAO0NAQgAKP0CBjoE7AcBLCIACQAPBAAAIvkKAC4DBAAU",
	"2wNkD/Yr9Q8EAAcGDwQPBAAgAqQBAOEDAAgABAQAAAICAAgABwQAANcBAAgAAQQAAhUKFfsIAAIDJgSJAAJUAA8EAAkw9vwH/wUx",
	"8Ab7GgIi7QIyMDHpDvgIAAsEAAoWFA8EANkEUgEABAAApAEAWgFA/wAB/wA4ALvHAMg3CCQAAAQAABAAAAAQAAgAAJcBAO0HAggA",
	"APAHEf00BgAEAAAsAAAEAAAMAADlBUD+/QD84F9A/QAB+xQAcQP8/gD9AAQPIGAAAPn5/vcFNgAyAAFDAAB3DgENAAAWAAL5ByAC",
	"+UgACABABBXiAAgGAAQkZQL8BgDzBB4SAWsSAFYEIvoASAgCZQIQ4DgQDyYsIg8EAP8wEPwBFCb9AVEaBQQABroVALYBAAgADAQA",
	"BBFKB/oFAAcABQgADwQAFAvtERHZOQ4PBAD/AgLUCwAKAAIEAAwQAA/qHw0AqgsDCAAPBAAACjwAEPD+CQAJAAQEABP6Dw4B/BsH",
	"CAAJBAAEJAoPBAAAIvEI3xtBAAAA7TsAE+kBNgEEAAPzBRDQFyoDDAAPBAD3A38FDwQAIQwhAgkEAAryAQUEAABvAEzwAAD0zQEA",
	"1AsBCAAEzgUPBAAHAncAE/SQAgnbBRPuTjILBAAR9BAGDwQA+QD8FwCLAQCaF1ACAAEA/bE/ABkAAwQAAOgHAAgABAQAAJYBAJAF",
	"ADQAABAADwQABQAkAAAsAAAMAHUA+wD///z9/gUFVAAV9/8DEvvFAQCyBwMBAgT46wEAblH4AAEA/vavAvcFMfYACwgAAwAUMQAA",
	"9AIOCwQAEfkhDlUX6fcABgAQAwQADwIO/xwKzScPcA0JAQQACC0AAgQADhIAAwQAEer3AQgEAAEpDiL6BvsnAQUAAP8NABoABAQA",
	"AtYLDwQAAhPx3iEA/gkACAA3APECAAYI8wU/7QYA/xHzAosDAK8DAAgAApcLAH0LAg4ABBAADwQACg/eAQYABAAh/AD4AwzoAQDc",
	"CwOQAQD+EQAIABH8ASoACgACBAAP/AcCCgQAQPUAAPQgBGP0AADyAPcGGBH2CAAB5DMGBAAB/wkEKxoPBAD/XQD8FyUA/WMCFfys",
	"BRPq6TMBCxgAEQAOBAABvA0ABQAABBgB/gsQ+gAgAAcGE/XUBQL+Ew8EAAIFYAYLBAAP/wXnBIYBANcDAAQACOADAQAQAAkAAwQA",
	"ALkDIQIBpk8ArycAwUcgAASfBQAdACEA/5gNA78BASgEAwgEAQwWADEAACAAADhYIAT5+iUiAv1kCAArAAD+A2UA9/j+8PVrBAAj",
	"DkAAAPv9KQRA+gAA+f8HQvkA/QP4AQI4HDb3A/0bsAIJAPAD+AT7AAD0CgD3/PsAAPELAPX7OQBgAADz+vkEKCg0AvD4WiAQ4CoE",
	"EAABUBYAAEAPBADtAv8BA4QBA9ARBZQBDwQACQIpAAAEAA7UOwkEADH+APmEGQAMAAAEAADhAQEMPAIVAABrABL7GUoH6QcC+xMP",
	"BAAAEfkPAgAgDBL8/EUW+IkABQQAE+8WCg8EAP8wD/0PIA8EAAUMSQAA/BcACAAPBAAEIP0D+SsRAAMeEAcZBAD7HwJEABT25AcP",
	"BAAIcvT5APoI7AwPCgEEAAECCAL/Aw//BecPBAANAk0DAJQDAAgADwQAEgKUAQI5AAAEAAIQAANDACL8/3UFDUcCAMIDMfDw8Qlw",
	"ALIFAiAAAgcOM/kG+w3GBFsEAh4ADwQAAEH1B/wDADIAcAZA8QAA8UA8Q+8AAO45AFbqCPgA+VcEDwQA/wAAqAEUAfwXALwfABEA",
	"ABkABwQABBMABOQBABAAAAwAACgYABAAAAwAAAgABAQACBAAIP4C+C8gAf3obwAwAAL+jwAPJEH18vn/yh8E7QEH/BciBf7yASMD",
	"+sgBBUACEgf4DwGIBAAAIgAwAgARAAQtbARLABLzINwhFuoEGBDkBAhQ9gEAAAQIShLw/1cPBAD/AwCQAwAIAAIEAA//BQsMHAAB",
	"BAAJFQABLgAF8V8JGwAABAAEzAEKBAAT+QA2QPgEAPgzAgZ+EAWdAA85AAMC/SEACgAFABAQ6gUANADnDAoAAQQAEeBJEg8EAPkE",
	"sgMECAAPBAAYBJwBDwQACg8lAAAQ7MwNAAkABQQAGPoBCg8EAA0A/AMDAiYg9Ab8fTMAAPMQDhHwGFAN5AsCNAIA/wcP/wP/CQ8E",
	"AD0x/QD7/QMKAQIB/w0x7u/2oBUT+/YHABkACwQAAiIMAAQABEAAEf3GAQXqHQ8EACIBAwIPBADpBOYDAoAzAvQNAvwXALoPAhQA",
	"AAQAAAsYALw3BG4BHwG4twAMBAAC1UsCTggAHjwAXAAV+9gHAGwAAP9vcf0B+ggD/QQMSABUBgAgAAG1IQH4LwEXAgD4LzAF+/0Q",
	"ACD/AQAwwfcAB/oD+gkA9wAHCSEAAwAkYPQA+AAB+wQEJfcARyYABABB7QcA6ksAAFYEB/8FIQDwpAAPBAD2AY4DAAkAAwQADBAA",
	"DwQACgSZAw8EAAgIIwAGsm8q6en2AwkNAA8EAAAQ9wAOAAkABAg0AQoEDwQAAADiOQQCBgIEAAFoFg8vAAUPBAD/GwjLAQ8EAAIA",
	"xgEQ/owNAA0AAPQVEP0BBAACJAERAAMEACD8AwEqIOsHLgAAEAADBAAT+QCEUPkGAPkD+xkB/Q8zA/0CBBQB+C0CNxAR9uIBAAAS",
	"AAgABAQAGPfZA0HuAwDsJgAABAAl4wwsHA//Be4FBAAAmwEGdA0AnAUACAAHEAAAxQUFfQsFBAAIIAQAEAYAzQ0ADAAPBAAEDUAA",
	"AAQAIv7rkT0R/a0lATIWBWkAABIAAAgAAH8WAAgADQQAAQMCAtADUfkK9QIAPWIESSQA/wM3AADuCAYBBAACLwAPBADrBtoBAuwB",
	"AORHAJQXABIAArIHM/0A/84BALgXBcgDAH0DA9CHARMAEv+TDQDMBQBIAABNAAAQAAB+AwDYLwAjABL+IwAw/PoD4wEAZgAx/AAD",
	"ADqT///+AgP4+AH18xcAHBgBCAAQ/gJAgAAAAAX5+/4GuAcAJQQAAwoAFSQB9AEA+wVRAAD3B/l2ACEA+S0YAQsACQQAMAXw/lB0",
	"AwAgIADoLBQBKgx2ANwK+eAA8BQUDwQA7AKAAQQEAA/xYw8NIAACQQACjgEABAACkAEBJAIBBAABEAACJQABCwAEBAAR9I8DABkA",
	"ALgRAQgAIQcA+CsA/Q8CJQgERgAAHgAICAAFBAAQ9kAKUPUAAPUB/alCAwDzBAVCEfE/AEEAAO0GIl5S6AAAAOMSAAEBOg/+AfYP",
	"BAAmBvABDwQADgL8EQQxAADRAwAtBAC5DxL1kgMA/gsCCAABAAwACQANBAAECgITACR0MPn9AgAeAAsADQQAC94BD0mwTg8EALcM",
	"7BMODwQKIAAPBAAAAOwBAAgAAQQAE/3bAQI2AAELAAUEABL1shEPBAACEfkdHAAKAAH1HQRuCAJHAAICBgMKAAIEABL1ZwAhAPNL",
	"CAAEFAAAZgACFAL+BUMAAADmGhIYAAdYDwQA4wSLAwD4JwBTAQAQAAjnAQP0DwakJw8EAAkAQQAACAAHBAAGQABQ/gACAPzJZwKf",
	"AQQ8FiD/ActhIvLyPAAD+xEU+7oPBPQjEPn4nxAA2glAAvsACAEEAt0BEPfKAQAGPDAJAPY7AADqgwAYABD05A8ACQAABAAT+u4n",
	"EflsGAAyAgI+CAD/BQsgBA8EAP8aBI0bDwQABgHLAQYEACH//PMBDP0NAwQACy0AAh8CAP4HAw4AAAAOgAD5AQD5Avv/DhgBH1AI",
	"BRALBAANUQQS7f0BCgQAENUFAA8EAPIClgEAWgMACAAF/JUABQABBAACIAAA4A0ACAAPBAACAsMDDwQABADgAQD2QwuGAQFXAEHt",
	"8O/9BI4B1QMBZwYKw3UBABoCzgkPBAACBAhoBwAoMQAA90EIBAMaBwQAH+8ANgIPBAD/TgDqAQACBAAIAAAQAAXUVQEEAAELCgD1",
	"AwC/AQQAQgAVIAMDPAG8BwcPBBD4FwAQ+AA6IwD2KwIE3AkPJ1wKAP4LAAgAAgQAH9tTAgcPBADMBukDAJwHAgQACPwRAgoABwYA",
	"APU7A/GfAugDAgYAADkAAjwAA+sXAwwQBCgYADEAAEAAANIHQP4AAvzvawMwAAA7AABRAGD09vL09QQ1AAD/AwAIAAAeAADMD0D6",
	"BfwBH2gz+QAA+CcR/vwTMPgA/dhVABEAAQEmQPYDAPk9EED1AwD4+CdA9AgA92ga1fL6APz6+wADAO8A//Q7IGLp9wD/AAkAOAcQ",
	"JA8EAP8LDA0MDwQAHQDtawDeAwImWgASAAJRAATOCwQEAAAmBggIAAN9AjAA+QHiY0AEAAD7AFoSBgBaAAZsAtoJDwQAB2/1+wD7",
	"A+8mAA0PBAD0AmwBBgQAD3IVBg9/EQECswEE3AMEIQAGEAANPw4DBABR9Pby8fQdAAH/AxAD6j0CPgAi+gUvEAaxJQFTBAAmAAAN",
	"AAUEAAAAKAAS9AD8ERMFACYDZwIE/gch7gVGBgAEAAMAMgD5DRDbCQAPBAD/Eg//AwcCZwEPBAAND/8DBgAFAADTFQAIAAAhAAsI",
	"AAQEABD5H34ACQADDwQDPwAhAPf/BQELAA8EAAACAjgU+/5TD04iGA8EANMEiwEE/A8EXAEAqB8AABgEEAAEBAAEMAAABAACMAAE",
	"wC8CswEAMAAAvwkAIAAAUQAEMAAR/0YYQv0A/v/idwAoAAYMBEH6+vb17ocx/Af7wP8ABAAAGQAQ+2IAcP4AAPkH/gdLACX5BCZ+",
	"EPo4CAHoMQD8DzAGAPZvACL2BvwRwvQFAPMA/AMA8ggA8RcMAhIMdQIA7AgA/vBDCjEA2/S/AAEMAA8EAP9OAPQzMAMA/A8SAA8A",
	"ALABIP4DYAYl7gIOMAL9EQAkDAYeAgYEABT530kD9A8EDQAPBAAdAv8BAP8FAAgADwQA8gBeAwBtAwAMAAAEAA8QAAMEfQcABAAA",
	"/wMACAAFBAAAugEACAAEBAAJIQAA8xEA4Q8ADAANBAAw7u/42BEB/AEAEAABBAAAIEISCAAoQfkA+QUAEAAYAAQEEAAbiAP4IQAE",
	"EgAIAAABTgB+BAACkAAKDkDyAADyCAAxAPUC/hUCACgD8AsA8icDADQPBAD/UALaAQDYAwJJAgD+BwDkTQBhAgKaAQMEAAApAAAn",
	"AAAMAAwEACH5AtcfAAsAAeEPCv8DE/niCxP4CAADHEYNBAAR6mIuAAoAAhQGAiMIDwQA3AB4AQAIAAAEAAKSAQCuAwYWAAIKAAMG",
	"ABABwBcB0EcAZQMAuAUhAAIGAAAeAAL0NxEB/gcCKAQAwwEAp/cAwgUA8E8i/gHwRyH6AMoPA9aXBV0EYPX87vHxBlYUAPgBBB0A",
	"AQ0MAPxvEf7cT6D7/P4BAwAA/gP+ACQzAv0CDjCQ9wD6/Qj3AAD6YgBh9gAA+f377gMQ+GoAABw6ACwQUADwAAL1jgAAMgAEQBIy",
	"4wAGAIAADQAPBAD/Dg7wTQQEAAIkFg8EABAAnREAGgICbgIDvgsMPgAE+zsH/hMBBAAQ+QAcALgBABkAAPcDACQgABkAJAD6UAAP",
	"BAAAAtoDI/sF8QUPBAD/CwCPAQORAwUEAACcCQAIAA8EAAEAMAAACAAFBAAA3AEB/wMADQAA3wUBCAACngECHAAAIgwD4AEHBABR",
	"9fbx7/MOAgAAFgEIABIDHgJz/AYA+vwCA7ADAAQABKEAAB4AAQsKEPdiFAH+BwIAIED1A/wCAjAi9AFSPiLzAkQcMgD1+ggABfUx",
	"L+cE+R3vDwQAFgIcDgAKAAwEAALgAQ8EAA4v/gH/AwMABQAAzwMACAAA+gEDCAAAKRAACAAD/W0MACAACAABEAABBQwPBAAGIPMC",
	"ACAQ++AVEPEvFA8QCAQPBADeBEYDBIsBDPwPAeoHBxAAE/+yDQAQAAGPAQCAAQMgAACoBQAeAACuPQEIAAMgAABRAAAgAACnARAC",
	"+w8Q/z4gAAECIAAATwAAOAABKADRAPr68/UE+QMAAPwH/fwPARYAAg0CAb0DMfoK+eI/BgAgAwgAAOIDAPwPAwiOIvYJ/A8i9QkA",
	"SgEGrBD76zcBXSQQAQCkQQL+8gYncgA8ABDgMgQASgAPBADtALkBAAgADwQARDD8BACuCQCSCQD7AQATAACwARD+HAo1AO8B4AUQ",
	"/EUCAAkAAd8BADAUAKYBAAwAAwQABAAgAABcAv4FABYADwQABA/ZRQUCbgAPADD/AQCvAwAIAASkBQwQAAAjBAAIAAAEAAgIEAEE",
	"AABUAwAIAAQEAAgtAAHfgwARAAYlAAH8DQJXADHu8PgCAgD+BwAQAAEEAAD+CwAIAADiVwO0KwECGAT3CQQIAAL8JQEHBgD8DwAI",
	"AAAAIBECHw4GUSYCAxgA8Q8CEwoAEwYnAOR5Bg8EAOoCiAEPBAAZAM0BAAgADwQABgAgAgVXAADbDRD9kgUDSQIIBAAm7+4KBgEj",
	"AAD5BQDiOyD8AeybAQoEBAQAAAYCAAsIEPgABgL/AwLoAQMdPAAdBDIG9QLUDRDzOwYACQAA7mUDCABEAADtAyoAAgQABHEqDwQA",
	"5gaSAQLvAwEGAALgRwGfBQAPACQAARIIEQCkGwV8AxD/GwQBABgCvQMD+B8AIAAAMAABQQAA7xkw//0Av48Q+y8AAeUBAA4AAV4k",
	"YPX8/fDxAmgMIfwDJwQQAu8bAEUAAFAAMP37BwAUEPsZAAMAIAQNKAEEACD6/voLIAD6XAol9gL8LyEE+MYAAQAgUgEA8QD/LBgB",
	"FACw8wD+AAQA6QAEAOQoDAATAA8EAP0CDQoACgAEBAAPEAANAwQAAO8BAAgABCEAAxAAAA0AAAQAAAoCAdYJABUABAQAIe/vOgIA",
	"FwAj+wFFEgA9BAD+BwEoNgDxBwLPAQEAIANTIjEA+AYLRgAYAAEEABH282EA6AkwAPYDpQJAAADz/z4yEPIaGgAiAAcEAAP/HQ8E",
	"APoCZAEPBAACAMAFAAgADAQAAp8BAAQAALYBAAgADgQAAfUBAKADAJwDBDEAAA4CAVIEEfWdYwJ7AAREAAQIAAIEACL5BexZMPkF",
	"+d8fABMABSmaAf8DAPgBAVAACgQABfsHAgB6AiwYIgDtOQAABAAW5gsADwQA8QBkAQAIAACvAQ9PAQAJBAANIAAKswEE/wMDBAAQ",
	"/YgdAMIFAA0AAeADAQkAAgQAE/aYHw8EAAAR+yICAAoACQQABVwABL4JAfwNAQgKAlwAAQgeIAAAAB4hAvvwCQX3IQMEAAD/Aw/p",
	"U+UE6AEEXAEA8D8FUwEB6wsCGgACBgAFywEAogcACAAFBAAMSAAKCwAABAAC4m9gAgAD+/z/0DcAABAAGAAEJSgAOEAT9ptPIvwA",
	"oAMQ/EwIAQkAEAHpFVIAAPoH/vwPMAf+BwcgQAAD+wCDOAECWAD/AwMACgTsGRP2CAABBjxA/AEA8xAAAWMAYQDuAP7z+m0GEBcB",
	"AgQ/Ag8EAPMEzwEExgECdxMABAAApgkACAAGBAANDwYCeAMCOQAABAADNAID7AMAfgES+dkHAA8ABQoAMP0AAPE7EPsIAgAQAAME",
	"AAAbSgQjADAA+wYABgCyGQAABgETADEAAPvAaQHAAQH5DQH8AwIIHgAGJgAIAAAEDgJSAgBgBgEIABDvEiIACQAB/5MQ6CYAAg4A",
	"DwQA6wa2AQ8EAAkGHwIFEgQPBAAHACACBCfMIP0Cy0UACgASAPRXAgsABUQKEeycBQA+DFH8A/4D/B5AASICACwiABsACQQAYfkC",
	"/fwD+wBuQfgGAPfiAQH4AQECAhD5CEwh9gAbhAAaAAEEBiAA8gIEAw8AAW0AAgQAAj8OAAoADwQA8QbgAQK3AQwQAA0EAAYgBBAA",
	"3wcF8AELBAAC5QEAvxEA9jUBDAAA3QEBCAAxAPn18D8BJAAB6c0ABwIADQAFBAAA7auT+gT8A/kA+gb5NkgIBAAC/wMh+gcIAAAn",
	"BgAIAAAAwgEEEBHzZwYDBAAAAFAVAy46CgIwDwQA1QTWAQSrAQAIAADYHQDoZwAQAADgPwAQAAFxCwHgFyAB/wSABLkDAKoBAJsR",
	"AR8AAD0AEP0AQADAPwMoAjD9AAC+RwAMAAAEAKID/P///PwA/v0BJAAA+wEAgAGx//4A/wECAPz2/vK2PxD8awABWhAC5xkQ/CU4",
	"AC0AMAAA+wAsANoBEvwNeEH8BQP7/gUwAwD3wQNA+P8D+QgAQPcIAPvPFSD2CNJPAAB8EPSuADAAAPJ/BgAEDALsIUABAOwCPhIR",
	"+T8GDwQA/w8OCxAEBAAAuAEMHAAMEAAAsAMQ++KBANUBADEABBUAAQ4CRPPy8/J/EwEVAADyPwMIAAAJIkMBAPwFtw0jAPr1ZQcA",
	"KA8EAAgR9AIAEfz/BQBVABEDBFAHZiQQ8FICAAkADwQA7wK0AQCQAQIIAAAQAAHgAw8EAAMd/Q8KDLUFAEEAAAgAAAQAAMERAPkV",
	"A98BAAcAARAQBG8ACAQABFIGCEAAAAQAAAQGAAgAAAQAMPkCACkcAQUCAfQFAAoEAIAAAPw3AEAAEPYEBAAZAAEEAEHyAgDzawAA",
	"/wEACAADAFAPDyL+ASUBAf8BAwkAAwQAAu0BDw8CCA4EAAi/AQD/AQDxAyT8A1IGBwQANvPy8v8DEAEBvgAgMAI/AAD/AwAIAAT8",
	"AQa4CQL4GQP+bQAEAAEPBAD/AQAIAATQGxD0WqYAPAAABhICAQYhAO9BBAAEABDrkAgACQAPBADpBPMBAecHAAkAAP0HApYLAqwB",
	"ARAABg8AAAoAAAgAAgQAALxHAAgAAN4BAAgAAgQoAAoAAgQAAATAAPQHAP4FEP75CwQDSAHlBwB8ACH28hIUEP1IKBH+PgAQ/OAn",
	"AA0CACgA4fsBAPsA/QP8/PwE+QD/KGIw+v7+Rh6gAPkB/AD7/QMF+LYgoP0FAPcAAQP6/QT6A2ED+f0FAPXyHwD+BQAsAhH881cw",
	"AADvLDoDARQHDwQPBADwAFwBCOYBAgoAAgYADAQAACAAJwD+WI0CsCcGEAAA/A0CTQAByA8BBAAA9wUAHAADYAAB/Qdg+QAA7+/5",
	"EAAAQAYA0xcB9QkCJCQB5QMENgAA6UkBCAAAPwAQAgsQAvQnAPkDANwpIvcBCTgACAADCTQA/i0QA/0HAP8DBP8bAVUAQe0BAAB1",
	"DA8EAP8CAu0JALwBAA4AAf8DGgG2DwAgAAAIAA8EAAYCIQAAQwBQ/AD9/wF7BQDmAwHzAQAaAAUEACb68/kVALorAfcBAAA8AAgA",
	"AAkGAAkEAhUGIQD6UAIACBoA9SMVBAMuBAQAIPgDBSQAAmYAfwAx9QH1NQoB/iMACQABBAAA/ksD/A0PBAD8AlwBDwQAAAwPAgQE",
	"AAAaNgAIAAAEAAKlAw3eAQAEACD9/8IFAN4DAEoCABIACP8DEPuSBQAQAADvHQAWAAH5AwIJAAEEAAAYAAB8ACL6BP8BMPkF+R8C",
	"ABsAQAD6/gH9GwEJXAEHCgcEAAJTCAECIDT0AgL+UQDyCQD+jUEAAADrsgQPBADeAEQBAAgAAH4BAAQADPQnAJ4XAAwAAAQABBAA",
	"AAgACAQAATAAAw8EAAwAALMBAEwAAxMAAeAB8gL/AAD+BfwAAAX9AfkF+gD9BgUKAfYBAVwAAAkwUf8D/PL4rQkx/QX89CcBrisA",
	"/gUA5CdD/P4A/BgANPsG/gGMAQQAAAIyAIKYAQomAPcDAAyIQP0AAPbMnwGUAATsJwAWFgAlACAA8ZcAEvtkYAA/BgA5BgMpAA8E",
	"AOkAkQEACAAPBAAXBF8BDwQABgIhAAHmAQGUoTH6APnlCQ5rADPu7vW5AwDoAwH8AzD8Av4MUgCdEQAYAA0EAAGzDwgAEAMJAAEA",
	"FgD4FwGGAhD1AAoACQABAgQABABQ8QQAAPaJBgANADgAAPJOAg8EAOgDlAEBrQEBBAACEQAPEAAHDwQAAAChAwAIAAwEAAD7CQK0",
	"JwHaAQREAAX8CwCLNxL3/wMQABocAPsTCkwAABYCABIAIPsGAAYAEgAg+gT4GQAKAAAEAAJcAAPDFwQicBD6/DsVAOgzAgICAPwJ",
	"AWsAAP53AAIsAwwADwQA8wSbAQOYAQfvAQwQAAHdBQSPLwIEAAChAQIiEAIEAAD/AwYJDgCjAQAEAAAMAAEEAAAfAAAIAAAEACHu",
	"7ZQBAhMAAP4LAAgOEAEtAgH4GQBaADH7Af3qOSH6BLoLEAANAAIAEiD5AwAsQPgA+gX5MQBCAAD/AwAIAAH8BRwAAAoBAGgACQAA",
	"BAAAR24ACAAPBADZBJMBAtQBALQXAO8BAYQnAREAAOsPAPgXBCgAABAAAFwJAABAABAAAMMHAhAAA8EDAfgXAgsAAAQAABsCAMgP",
	"AQwAUAL+AAL6NwwA9CcAy3EAFgAR/JIHAFgAdAMAAPPx9fP/ARD8cFgS/UsAAP8BAQYOAbQVAmkCQPr8/f9KBAG2BQD+BSH8A0sA",
	"ANx/AP4DQPgHAPn6DyD3BwAOQfUA9ggABADsrwH0BRDyPAIAbQCJAgDvAAEA7QGTAg8EAOYDqSkACwAPBAACAhwKAAoADAQABvED",
	"AKUDAAgAC0sAEf6tSwAdAADHCQLaAQAOAAElAAANAAOVDwEEAAAZAAsIAAD8EwGxA2L8APwE+wX4FxP6Ew4CBAAA9hUACAAMBAAy",
	"9QD2AjJB9AEA+DFYAP4jAAIGAOGpHwL+BfcN/wEP8AEHAwQAAAMEAAgAAQQAASwABLMBBAQAARUABwQAABAAEfzrMwEhHgA/BAMk",
	"HjDy8/WYAQALAAdjBgAGBgAIAAgEAAIpJAFRAgALBgP9CRH4ACIBCDQAxh8AKQQBDBwAHAAEBAAm9f5Hdg8EAP8GBHoBAqQDBooB",
	"DhAADwQAAA//AQUCNQAAAgoMIgADBABC8/L285sJAO8DAvYBIfwB2hUAuwMBNgAA7AMCACYKBAAB+Bcg+AEAIgEMAgD/AQAYAAEH",
	"CgPQMyD8AegdAkwEAGcCAQIGAQN8BwEcDwQA1wKQAQTTAQIIAAAEAAIOAALmAQGlAwYPAAEaEAGYAQHYAQB0AQGeAQH9BwAABgQc",
	"AAAQAAAkCACvOwEUAFH+AAAD/fQjAcgjAewbAYkBAkAEAAQAUfYD/fT6MXgAJAIApwEAxn8AsBlRAgH+/v8gWCAABTUkEvuubwLo",
	"nxD72j8BHAIBHQgANggACACgAPcE9wIA//39AAAYAHQOQPwA9gACsgBaYAMvAAAEABDwoAAEdwIPBADzAhoCAAYAAJgBAvoBABIA",
	"Af8BAwoCARAABgQAAikAAAQAAcwNAU0CAA4ABwQAQP0A/f/2GQH4HQEhAAC2AQFAAgA7AmD5AOztAPwZKhH8+g0AGAAGqAUCLwAA",
	"/7kBMyJgAfwE/QD6HDoA/wEAIQAxAPkDAwYyAPkCCAAGBAAg9gH8KQIIygEECgAJAAEEACD2Av4DAHUOAA4ADwQA9QbfAQB2AQ7v",
	"AQgQAAG/AQLNAwIKAAIRAAwQAAEzAADqAwHgiwD4AQHQAQMfAAEuAFD58+0A7doTAh4AASUCAR8AAPcJABIAABgAAPqbAQgAAv8B",
	"AfwJIfoD+w0wAPgDvHUR+f0HEgcEJBD3nAwAPAABAQYR9QBAAQ8ARfMBAPNcAg8EAPwBrAEBBAABmAEH/wEC/wMGEAAEcjMHBAAA",
	"IQAACAAEBAAHEAAA/wEACAAB2QEA7BUBDQAEBAAAfhMAAAQADAAACVoDCAAABwAjAPwLjAR6AAA9AADSBQAMAAMEAAEACBb5AAgB",
	"+AcCADAE+iEAAFISBBa4AgAqABgAAP8XA2g0DwQA4QLiAQLAAwnwLwCRDwcPAAAFAggfAAP8GwEQAAIrAAMFAAEKCAULAAExAAD5",
	"EQDXdwG4HwL9BQEcAAAEAAbhBUH67fvx4AEAEjQBD2ggAfzWNTL8AAUlAHD8BvwC+/3/ABgwAfz95acQ+hIYAAIMIPoD+1kAJgAA",
	"AA4ACABw9wD4AP4A/WwWEPYrCAACPAAABgAaiIAA9AIA/vgA+3JgAFkAAwAgDwQA7gO1AQGFAQcEAAEQAAEFAAHOAQLoEwIQAAQE",
	"AAM6AAXuBQYQAAEEAABxDQAaAAH9BwEEAADwBwAaAAAMAAAIAAF9JQGzAwEeAgpeAAD4HQAAGBD87QUGABYQBCwKEAK8AQG/AQS+",
	"EQACAgUaIAL5CwL4KQICFAMKAAE5BjEAAPEaAABUDAAIAA8EAPICfAECBgAAnwECCgAGBAAIEAAAIAAEmKcBBAAA5CEMEAAC7AEQ",
	"/cArAOVPADQABCEAAAwAAew7YP3wAO3u/MgBANsBAGMAAPEbACsCAvwDAgsGAEACEPz7KVAB/QD8BAUGAQAQIPkEAHAQAcEbM/sC",
	"+AhOAAQKAAU4AgAWEfb8GQMIAgDsCxD3UAAADQAyAADwRgACDQAPBADsAKsFAAgAAAQADO0HDBAAAvE9CfQfAiEAChAAAlMAAFIW",
	"H/vSqwIALgBR/fsA7e6FASD8AugxAToAEPzNHQD8CREF/QEC8mUADwIBBwIA5AEC+yMA+wUCAAYwA/sB/gMAFAQA/w8AoC4A6x0A",
	"+AUA/wEAbgADBAAQ9E88EQL+IwABCAATAA8EANsAlAEAegEADAAACAAAtAMArgEAGAACFAACuAEABAAPEAADAaQBBRAAADwAAGwL",
	"ChAAASC4If4EvDMBv28Q/e8pAewTEfwQEAArAACkl1Dz7/b+9uoPEgRBABD88RkABQgACAAA+jcAOQIAPRAACQQRAnYAQvsE/P8F",
	"AgDbJQAKOCD7/twJAdkHIvgE+EcA/AMiAPYXGAAEABD4/rMAAjIAExhyAPIBAPv1AGc4DwQA7ACTAQAIAA8EAAwAeQEACAAPBAAS",
	"AAQCADICAs4RAP8BAtMLAGwAANIDAdwZAA0AUgDw7/T2pAsQ/EUCACUAAQiOADAGAbwBEfzqCQCpAQA5AAAAFAL6GwH4DQEJAAAK",
	"GgAJAAEEAAD+AwAIAADkIwJWCBD1BCYACQAHBAAAAxQDCAgPBAD1BuABAZgBAWkDAQkAAMkDAMwBAQwAAgQAANUBAAgABQQAAQ8G",
	"AAkADAQAAP0FAf8BAL8LAkAKACMEANrPAdUzFPDxJwDdAQIkAgMKAAAEAAIABjD7AP4AHgAgBgAbCAATRADxBwP3AQL7L2MA+AEA",
	"+QECQAAUIAQFHgAEAABgAgAANhgBPd4f8f8B/y0IEgAACxAAzAkADAAABAABEAAENAAA0g8ApEUGRQAB/gMACQAAghMR8f8DAPUB",
	"Ef1WCBH+KAABAh4AEAIB+hUACQADeAAAKQAg/AWyNwD4BxEA/xEgAfv4EwEPAgT/AxD3PG4C/jsBCQYS+AAYCGYcD/8B4QCCAQHQ",
	"AQPYAQDwJwBXAQ/sNwcDEAAADQADggEApgEA4BcAIBgCHAACCEgABAAIEAAA6T8AsAMgA/mXBwJwAAFBAAH/AQFhAEHz/O/wnwEA",
	"JAIANQIA9DcAKAAA/AkAZAAA+QEhBAEIOhD8XAAAAA4wAf0E/wFw+g/6AAfy+cA3APttAO9hEAEIFCD4BgAMAOOnAGIAAQ4CAFh4",
	"AQKOIfT5voAg8gAACg8AAuENBAAF2REAdgECCAAAEAABngEBBAAP+wsAAAUAAwQAABwAASEAAA0ABBwAAQUAIQD/x7kiAPynBQAU",
	"AAVsAAQEAGLzAO/wAPCQCwQaAADgAwAsDAEIAAPwDwIEAAAADAEVAAEEABH6AAwAABYAAwgQAgBQAeATEPgCFAICFgAnACD3ARkC",
	"CgAQAP0HAv4PDwQA7gT2AQKdAwH/AQAJAAbvAQIYAAYQAAzDAQT0AQcEAAIQAAX/ARD9rAcB8wMAFwACMAACUQwBiRUAhA0A/gMA",
	"FwAB5wEAF1wCACgA53kA9QEC/wECPgAAGQQFwwcAWgIA/wcCCgYB/BUC/AMSAOULARYAAV8EAQgGAQIGAXUAAQ4ADwQA+ALSFQX/",
	"AQYEAAwQAAG+AQIJAA8EAAUA/wEg/wEOCDD9AP6IFQHJxQZaABD8Gg4B/wFA8/Pz8/8BAhQCABIAAQZ2APMDAOcBAPoHARoCEQFA",
	"BgBYAAAbAAEIAAABBgEIAAFcAAEEACD7AgMgEgMAFAD+CQAIAAECEgA2AAAGAgYDBAgHCA8EANYAdAEEhgEACAAB/AcBegECyBEA",
	"IAAAbwECCAAACgACmQEIEAAASAMBmAcAMQAA+McDxB8APggAoAcAIAAAEAAAHFAAxA8ArWMAOgAAuA8ABEAA1AEAH1AAcAJA7wP3",
	"8so9AMFBAFwAANsRAGwAAPwBAAgAIAD8rlsA8F8hAPweaPAF+wD8CfwBBfj7AgQGA/0A8gD6AAYdFiD5AdcXAFMAEADMxWAA9wD4",
	"Bfc3OAD5XxEBoAAAwAAAY2oA/RkAKQAAFggAFAAPBADqABkBAHkBAW0BAQQAAu0HAAoAAgQABKA5BgQAAyAAADsAAiwAAQUAAckV",
	"AQkAAhUAAMAFEv3CCxD5/wECQQgADwAAyAEBbgJQAPYA7u6aAwALMAAaAA1QHAT8BwAIAAEKABABCgAgAPv+UQEABBD6uUMBABQB",
	"9gUAABQAGhwD3AEg/QT0AwGEABAAYBIAAHoA+0kAAwIAIAAPBADuAIYBAB4BAJsBABAAAP4FABAAAgwAAAQAACIAAAgABQQABUwD",
	"AAQAAbABBzEAAQsAAQUAALYBAQkAEPxZKwD8BwBkAAASAAD8IwAsBJEAAPb38fAA8QagAQAEAAEvAAAFAAQIAAD6BwEaCgIPAAQX",
	"AAC2C2D7A/oDAPoACgD8EwH4BwT8CQCUACEA+AIUAPxREAJSDgEEBhX1BCoPAQj8AJsBAAgAAP8BAAgADxAABwGsAQEJAAUEAAwS",
	"AAUQAFP9Af4D/fwLA0kAAMIBAHQGAQ4AYPb39u4C8RwEABEuAoAIEPxaDgAmAAINAAQECiL+ARsEQPsCAP1ENgIOGAAyGBD5/g8Q",
	"/PsREAAFABH4MAACDwIB+AEAXwAwAPwD/wECGgABAgoP/wHhAMUBAXgBA9cBAIgBAR4BA98BAAYAAv0FAAoAA/UBANEHAgoAARoA",
	"AAkAAQ4AAEEAAhIAAmYBAch/AQD4AhAAALavIPwAkBkQ+gQGAvAHAGo3APw/AAwAAJ8LYPbu+vsC+6M9AkoAYAAAAAT8A+kPEQEI",
	"KAAQAFD9/vz8AkcQAA8CEPuwAPEI+fsBAAUHAgbzA/0ACPoH+fz/+QP9AwH4JSD7A94PoPgAAwgA+P0A9wAMSAFcABAKAIAAiRR/",
	"APUM9AD0DQEC4QwEAADEAQAdAQHRAQEEAAj/AQAEAAwQAAB/AQEIAAA7AAKqAwAhAAJQAgEsAAIFAAAoAADyFQChAwAMAAJyAgAb",
	"AAHABQEuAED1BOzur38AMgAQ/PRdACoOAwAmEf3/AUP8AP0CAAQABgABOwACTQog+wQABAABBgBeBAFhBBH5/QUQBQAEAMTRAAEE",
	"AAQEAwkIAv8FAEYAACwSAQAOBBoADwQA5gCGAQCTAQbfAQzvAQwQAAPLAQMEAAEMAAEFAAIEAAgPAgDAywGeHSIA+hMAAG0AAAgA",
	"AAgEAQwAYPX78O4A7s0BAfIBAWUAEPzrBwD1GQATAAH6swAMDgDyCQEzAAItAAD8IQD/BVD6AwMA+duTAP4VEgQAJgD2ASAA+AkE",
	"MPgA930CA+UBAAQWA/gvAAEOAAIGAxoADwQA7wF6AQEEAAJlAQ8QAAcE3gEHBAABlQcACQADBAACIQABmyFT/gP6AftYeQAnFgE9",
	"AAHEAwAEADD1+/r/AQHfAwHsGwDmAwAcGgX/AQBADAAtNgG2AQAzAAD/AQElCAFFAAABHAFKOgAFkgAADAMAEgL/JwD+CQP8HxH6",
	"BoAB/BMD/AkABAAP/wHYBMEBAs8BAtcBAPAfAWkBA98BAAYACO4DAAYACBAAAAoAAjAAAA4AAEIAAQwAAf+vAswLAfwHAbALAMwF",
	"MPoAAG5vEALuJwO9twHrMwC/AQANAHH3Avbw+PoAsVcBSgBw/AAAAgT8AvwHAClQADgUIAEEsAcx/AAEFSAABiAAjQDg/AAFBfwA",
	"9/4B/RT9B/leCjAH/AcHADIA/QL8BwCEABH3DAwR94IEAF8AAAQAAWgAAP85ABkCAwwADwQA5QCEAQHPAQBbAQARAACkAQ8QAAsE",
	"/wEC4CUI7QUABQABCwABmQMR/9k/AhwAEfq0EQL/AQQwAAAnEBD59RcQ+uwHAB06EQAuBhD8z5UA5TkQBCgAEf3oKQAACGH8BPwC",
	"/QMUMADCBQD/BQAQEhMG9ikA/hsBABAQ+QxyUgD4AfgCBlYDBRwAAygUAfsXAP4vAP0FAAwADwQA7gCOAQbfAQzvAQwQAAO+AQPw",
	"JQEMAAEEAgAJAAMcAAPsARD9tQcByB0Q+tgBABMAANEFAyUAAD4AMvn69HgnAhQCAWUAAOYHAG8AAe4VEPw4BAAEBAAWAAAIAAHz",
	"qRH+318ABQhQ+/sGAPv5DQACAgIAEBH5A7IC+hkABhIH/wGBAAD2DAAA+gEFAg//AfYABAABegEBBAAAlwEI7wEMEAAAlgEACAAH",
	"EgABzwEHBAABzAcC+wcA2lMS/ZQJAS8CAQgCAAQSAiwGI/r8VpUA4wkCRgIB/AcC4AMA/AEACAABfgAAVQAAZQgAFR4AKAAABQgC",
	"BAAgB/pJFgACagAdJAD4CwAgAAAMAgP/AQAIBgATAAAAGBD1CgYA/wEABAACFQAPBADSAEMBAAgAAXcBAZ4DIQAAwAUAeAMBYQEC",
	"5QEI7gMABgAIEAAACgAG/wEA4E8BDAACCBQD+A8CyQMA5W8Q/RgAMP0C+rMPASxoAPAFAf8BAJABADQAcPgA9PD79fchAALVEUT8",
	"AAAB/AcQBAaCEPwQAAEWBiACBBsSMPwABwkoAOTv8gkBBPz4APwABQAFAPwC+AAJ+Qf5/P76Av34DwAnZgH9BQBXAAD8BwD4ETAC",
	"AArm5QCuAAEAFABnAAENAA8EAOQAhAEBrgEC3wEABAAI7wEABAAMEAAE3gEI/QUABQACyREGEAABzmkADAAAmBUCeBUAMQAAcgEB",
	"IAAA7yVQ+QHv8ADkRwHqBQDxGQC7cwAMCAH/YQEJACD8BRQMwPwA/Ab8Af0E/AL8AgAGAPcDAEsAAAJSEAYCGACysQME+AL4AwDc",
	"MwD/AQXiCQD3DwAABAAMAAAANABHAAAMAA8EAO0AjgEG3wEM7wEMEAABqQEBEgAAzgEAHAAA3gcCGgADHAABBQAB3SEw/gH9DQAB",
	"wlECcQQAtAEAEwACUgBS+/XwAPCeAQLsDQAFAALfBQL8AQAABgBDCAT8BwAGAAAQBgEAghECsCsw+wT79Z8wAPoIAQgSA98hEPlp",
	"GAD6BQADCAJhAAAEAED3C/YBGwgAARIAQgAAjgAAGAAPBADtAY0BAQQAAKQBAYABAA0AAyUGCBAAAKEBAAgABxIAAHABAAgABAQA",
	"ARAAAv8BIAD96D0AkAMDSgAAcQEA/AcCPwAw9Pvw8icACwAA3w0AIwQQ/SgyAvwHAwA8An4AATkAAhokAQsoABAAAvwHAPybAAN6",
	"APMPAAAQAO8FAgAQAPwHFAL+AwAEABH3+xMACgAB/wkAZQABDQAPBADPAEMBAAgAAYUBBdcBAAQAAK4BAh4AAAYACO4DAAYACBAA",
	"AAoAAtYBBEEAAegPAOQHDRAAEAH4AQHkNwCLAQX8BwEEHgIAGACjBTDwAPpmdwD1QwI/AAAJMAH0F1ACBAD8/c3/EALsDQAECAA0",
	"MGD8AAgAAvxTBPAFBgX7APgB/AAF+wX7/QL4Bg38Bvr5DyAH/P2/EfkAEBL/DFQB3zMgAveRkBEJCBQAAQ4gAQv+BwB1AA8EAOwA",
	"1QEC3wEABAAI7wEABAAMEAACpAEG/wEEBQANEAABnSkB/wEE2AUAIgAIDAABZV0i7PwPIADT3QHbAwC9UwAMCAHPCxH9EwAABAQC",
	"+C0w/QD9ABoAETIB+LEADTgABAQBAAYAZggBABBAAgD4AQAQEv4yeAL+AwcGAGH2DPUA9gsABA8EAO8AjwEG3wEM7wEMEAABDwAB",
	"CQAABAABDQABBQACBAABwAsBEAAB6AER/gAKAeQ/APEBAPoDABcAAT80ACUAQPbxAOyiAQDLLwNlAADiBwI1AADtBwQABgD0BwAU",
	"CBD++QEDHQAANQBA+wIA+wAeUPsFAPoL+RcA6JkA/UsANroAcQoACA4B8wEBBAAh9woMAAD8SQAEAAB7AAAQAA8EAO4BegEBBAAC",
	"lwMPEAAHAHsBAQgABgQAAe8BBwQAANwHAPEPEACxNwEBAgB+BQJJAAAdBADsJwIOAED29wDsbKcAygEDZAAU/Bg6AOIBAecBAdtZ",
	"APwBACw2ABgEASAAAFMAABkCAv6vAAYcIQX6r2Uh+gAIAAD2BQP31wADAgBbAAD8AwD/hRABAQgABAAP/wHYAEQBAnQBBNMBAgQA",
	"AKMFBN8BAsgBA9wHAKkBAAgABJgHBBAABA0CAUUAARIAAdYNAlUABhAAMP8C+Z/fADQAAD8wAfEDALMPALwBAPwHACkAcfgA8gDu",
	"9/etaQDLBQDJAQDbFwAAIACoKRD7/CEATQAACAAAiABw/AD8Cf0AAwQEMAYF/OKvIQAF5zsABBggAQYAEACqmzH1AvkAECD/AQEi",
	"IAD4MxIAeSAG/AcCAg4P/gHXDwQABwGyAQHRAQEEABD9IF0ACQADBAAP7CcXAAUAAfoBABAAAVwxAgAIAMwLABMAADEAAAgAAAQA",
	"Aj4AAGlLFvD4DwMIAAAZQgAKAAEIEAAtAAIIAAAKAAAEBgAaBAAWBAAcGAJlAAD/CwIAGAD5AyAA+QFoAfsdA/wHAAIEAggEAAAE",
	"AHkAAAQmAAgADwQA9QbkAQGtBQAJAAMEAAGoAQYfAACgAQIIAAEEAACUAQgxAAALACH8Axw0AAsAALurAK8BASMAAEoAAAgAAMcD",
	"AnAUYfYA9ADw8ZgBABkAAggAANgZAQkCATUACAQAACAAAfQFAA0AAf0ZALqbAAUcEPsCTFD/BfsAAXQEIAD62RcQ+cYEAP0RAQIE",
	"ADcAYgAA9wr3AdVzAgQKDwQA9AbfAQBaAQPeBQEEAAGnAQcQAAaJAQUEAAARAADUDQAMAAAEAADLKQH7BwCEExL9AAQAGAAERQAB",
	"8D0BWABB9vf683A/AK8BARwOATgAAO2BAAgEAOYPAT4AEAL0DQJUBgAECAD5AQIEAAT8AwIpBIAE/AX9BPkC/HgAAPs/AjIAAf4B",
	"AB48AfgLBf4dA/hBDwQA0QR5AQF0AQSoBQMEAAEcAAEFAABpAQP8BQ8QAAQAEQAABAAADwABRAAAHAAD1DcABAACcAEBxVMAmw9A",
	"AP4E+uEPEvwAZgAFAAAYEACWAwAwGADsJ0D37wL52gUBbAAAywEBNBAAHSgAWwAA8RsB0zMBAyQBBAwA6zsBsF9ACAABAPQXAM4B",
	"AG0AAOYFkPkA/AX5AgIA9RUAwQAHAvMA+QAI+gAI9FoCAOZHMAkA8gwAAABqAN0AAFwADwQA8ADQAQAIAACGAQB4AQ8QAAUADAAA",
	"BAAEQwIBDAABBQAA5wEALgABMwAALQ4AFgAAakUAtAEARAABoyMACQA0/AAB/HNw9gHt7wD5+cIHAC8AABMAAQgABZoBANUDAEEA",
	"AAAOAOcDA/wHAfUDAg4CADMCARMkAB8AACkYAfdVAAIQEAf+BwL7SwFfBgf9BwACNhL2YgAPBADyBN8BBHcBDxAABwQSAAL/AQEE",
	"AAIRAAgQABP/NQQAhQMAHAQA4CsCQwAA2QEI+A1S9+8A7wX/AQE6BABTFAEeEAA/AAAqzAAIDhD8ABQChAAA/AUDKAADBAIB9wEB",
	"DAACCQAEAW4BDgQCXzYC+AFi+AEBAPcK/wEAfAAERQAPBADwAVsBAQQAAhIBDxAABwMSAALwGwAKAAIRAATRAQGIAQALAADiBQCg",
	"AwG3QwAEAAVDAAAWEAHCAQT/AQG5KwJmBABNAAAaNiAA/AUeANBTAkgAAOQBBEEAAggAAPwLAPUDAv4DAXcAAUEAMvv/BAJaAAAa",
	"AmcAAPgBEPsqBgD7AwD+AQEPAgD5DQEyAA8EAM8CMgECsQUABAACDgACBAAAHAAABAAA5AEEHAAGEAACIQEGEAAAoAEACgACTAAB",
	"HgAAzwECDwABwgEABAAAlAEAmDEBor8C8QMGIQABOQYF/Ach7vehzwCyXzIA/QQgFAHoFQG/bxEE60kB8gUAUBQACAAASwoAWAJQ",
	"CfwBAPj1EwBbIAAgBABRAAEIACABBEoKAAAQEPLPPwAeEAAcAAB/ABEBNnAy9wn4/QUDjwAPBADtAGoBAtUBAqIBAgoAAAYAAA4A",
	"BBoAAgYAAhIAAs4BAQQAAhEABhAAAYoLAEcAAhkAAgEGAfQBAQkAARcGAv4BUQD08gDuoNEA2AEAHgAE7AcBBwAC/B8ARgAAPxAB",
	"7wMAiwgBOgAAAQIB9k8CKQAABgYHCAAx+wIC+x8B+wUB+w9AAAD5CAIMEPiLAgACUgACNgCPAAEiAA8EAOwC2QECBgAAbwECCgAA",
	"rRMADgAP/wEAAgkEAAoAAhEAB/wFAA8AAcwHIP7+6QEJ/gEACAAB5gUCCAoAb3kg7u4QAAAkABD+2AMAISYAiCEBEAIA8gEAPAAA",
	"9BMAEAAw/AD/FSYAOwAAGA4B2YcBViwB+QEAFwAD4g0A/wk0+gAI+QEBFgAAOtIS+GUAAAEGAAQAAFQAACEADwQA7QLZAQGkAQBT",
	"AQPpAQEQAAAJAAUPAATLAQMIBgELAAESAAb/AQDqCQCCAwG8BQDtHwQ0AAYhAAVKAlL0APT0+F5fIPoEklUA7AkB7AcQ/R8+AfBb",
	"AAgKATICAUQGAUUgADAAAUkAAB8CAAgCAAICATACAXkEAP8XEQT3DwP/AQEWAAEMAAAEAAD9bQB4BgAaAAGZAA8EAM8AbgEEfwEA",
	"CAAAdBMACAAAGAAFjQEA7QMAVQEPEAAFAAoAAhAAAf4BAMgvABkAABEAAP4BAFcDAx8AEP1kPwDtJQK9GQMAIAATyADDAQVWAmAA",
	"8f/wAPPCmwDfLwD2AQC1CwAjHgCMvQAGGkAEAQP9LDADEAAAGwYBGQoRBA6qEAH6EUD9/gD/BHAAUDYQ+0QMABzoALNvIfQB4sMA",
	"/g0BT3QAcgAB3isCBQoAXzAADgAPBADiA4ABAwQAAMYBCOUBAgoAAf8BAA8ABxoAAwYAAP8BCDEAAP8BAQkABAUAAPMFApADALUD",
	"ABQAEf/QAwAcAAP/AZL8BQDxAPAA8fIYAAHb0QIfAADVAwAKAAFFBAIEAAFMAAD+AQAKCgAkAAHkBwAEAAANAAAIAAAEAAAmsgAZ",
	"AAHuAQPcFRD6gSoACQAi+QH4AQP9FwEFAA8EAPMCyAEBlwEATgEFDwAP4zEHAcEBAhgAB/kLAR8AABsCACYAAXx1AAMGAKQDASEA",
	"AOkjAMwhAQ0AAKcBYfHyAPEA8rEVAC0AAOQBAfQLMAD8AAQMAegHAwAaADgAAAgAACgAAB8CAAg6AB8AAABEVPwAAfwBABgCOQgA",
	"HvYBLxQCAQQABS4ACAAC9AECAwoACgAPBADyAscBAAQAAsUBDxAABwFxAQgRAAIgAgInAAIdAgAcAACsDwGCAwARAADoAQK3nQEh",
	"AAIuAgGsCVD89vEB8mdLAPAJAy8AAAMGABwAAfQBBT8AAOEHAA0AAPUpAdUDAOILAhgCAEQeBSUAAPoLAgsYAMNlADdGAP8BAAKe",
	"AfopAAQAAgkIA/pJDwQA2ACkAQAEAAAMAAAEAAAMAACsAQTOAQBrAQKBAQAOABAAX9cADwADHgAhAP7AEQQNAgA9AACQAQPYJwG6",
	"AQOCAQC/AwCDAQDAtwCvAQFuAQHzAQDUGQAIAAIgFnEABO0A+fcBBSwBIwAh/QClhyH6/cuXAVIAACkAQPr+AP0w+ADtAQA84ABl",
	"AADYEQDX5QIIAED9AAcA11MA9C8A3ScAtn9A/AT3/ksucAD6BwD6B/TnJyAAAFYoASoYAAASAhcEDwQA7wHQAQEEAAPhAQEEAAAW",
	"AAoQAAAOAAAEAAQWBAEMAAEFAADQAQAJAAAEAADuAQCeBQAYAAD4BwOVQwAyAAAfAAAEAAI/AABQb1Du//UA9AJOABEAAswDAOYL",
	"AUYCAO8BAeDJBDQcACAAAAgAAOgrAGACAOYFAAgAAG4AQQMAAfzzmwD7IwAZAAFCAAD9WwEACgP3AwIHAAECBgH4DQ8EAPIA6QEA",
	"CAABZAEB6QEADgAAFgABrAEC7wMBBQAEIgAEwAEE9QMAEAACowEBWgUA0B8CFgYAzAEACAACRmMAIwATAe0ZALcDUPQA7u8FjQsA",
	"yDEAFQAALQQALwAB/wEA0gcRANSPBOwRAPAXAT4AACQAAAUEDQQAAPYfAQggAPkXABEAALmbFPkAEAMHAABrBAEDAg8EAPID2QEA",
	"BAABVwEDEAAA+AsIEAABBAABEQAB9w0BCQAC8gEB9wsAowEBLQAAewMAnwsAvQMQBPYJALoBBUQABfoHgQAA+fr67gDvaEcA9wEA",
	"FQAA9QUAfgYA1gcG8BcA7SsAaAAAIgACSQAT/fEHABACBgQAEAFSPAL4RwCFAgAIADH7/QPqLQL4AQD/AQAWNAEFNAMECAEYAA8E",
	"ANUEewEABAACSgEAsgEACAAG0wECGAABEAABdQEBEAABCgAC7gEAGAIgAQGwUQL9AwA4AACcEQC0dwD0AzAD+gCNcQErADD5AAH8",
	"CyAA//0vALEBAEcAEgGDqWD3APIA+faCwQACHAAUAADuAQErBgDEDzH9BAQECAEsABD+WQACmAgA9DUA4AMBAQIAnAAAUggDBAAA",
	"OAACFAgQAd4HAPbPcAP9BgEB+fQALCMA+vEBADYAD/0B4A8EAAICDAECBgABswEACQAAaAEC3QEHCgAEBgABwQMGFwAA/wEACQAA",
	"fAMBBAQAKGUAjgEBoQEAGgABMQAB2AEAMAADNwByAPTzAO4A94YFAYsVBNwHAAcABgkAAFIAAAkAADoGAAQGAPQLAhwAAQBAAOwB",
	"AB8AQAD8AAZsBAH7HwMFAABaAEAA+gP69gsA6QkABAAAKwoC/QkBHgAPBADuAsgBAAQAAWIDA+8BAd8JAGYBBhAABLcBARgEAxcA",
	"ABEAA/8BAAsAApLbIP4BqRMCBCQBnOsACQABPAAABAAAIGQAnAFA9AD1AP0FAXxFAeIPAOAZAUACADQMANAJAFgAAAgAANAFAM1x",
	"ACQCAFwGAuwXAB4ACAgAAREGAB8AAJAAAPQdAd8DEPxGYBP5AAoA+SkBCAYP/wH2AscBAAQAAuEVCRAABQ0EAgQAAGYBBxEAAi8C",
	"AP4BAZoDAagHAjIAEPqKNwAdAAEiAAL0DwCdfwAfEgAMAACyAVD4APX29lK/Aaj9APIBAC0AAdMVAgQABdgBAeMBAF0AA3sAABoI",
	"AOAJAPIFAAwEADAMAggAAQAEADgAAAQABt4FIfv/GwIAASAABQIE+wcGIQAPBADdA0kBAOMBAIoLDeQPDBAAAfQPBBAAAB0AABAA",
	"ASIAABEAEf2sfwDPQQAXAAOdzQPIAwCc7wYxAAAAAgAIACACAdk5QfPw+vysWQAeAAFAEAAVNAC7AQDNCQD0AwPoLwD7DSP8B6ON",
	"AAwIAC5EAOr/ADUQAN4hBggAUQH8BQT80iMB+xuhAPwA+AICAgABAdTJEvUCFgECBA/9AeYJBAABdgEFoAECBAAA5gEHEAAHkwME",
	"FgQBDAABBQABQx0B+AcB9QEBPEUBGQAA0AEAwCERAAAGAAAMAEIAAT4AYAD5CADuANw7AKkVAFsAASwIARAaATwAADsSAWwCAOoD",
	"AHoAABgIAAAGAAwGABIEASYIATMEAXYAAPQJA3YCAwcAA0YAAAYAAQQAAPxXA/sDBQcADwQA7gBiAQLUAwJ2AQAKAA8QAAMDEgAC",
	"+QcACgACEQAQ/+QNAGgrAUoLABIAAfgHAbADAUYAABMAAC8AASAGEP+4RQAOAFH5AO4B7/IZABqQAEoAANYLANwHAuABAA4AAOw1",
	"AP4bAX8AAGMAANszAAQGASIAADQAAFMAAQwAAAQAATICABsAAekFARIAAA8iARg6Af8RIPoA5IMAGAAP/gH7AAQAAtUBDxAABwFq",
	"AQESAAIaAAAEAALEDwAkAACuAQBxAQMIAAGXawDwAQMsAAAjAAHaAwBAAAARAAGDnwL/AQETAAEoBgFkBBT9GDYQ/VgCAaAFAD4A",
	"AEUCAAgAAWAAAA0AADIAEP3KBQE/SgIEAAA8DgBOAAHvPwA6ACAA/OodAgUGAA0WCPYDABgSAAgADwQA4gFLAQErAQGjAwIEAAGK",
	"AQQLAAEGAAEhAAEKAAPcFwDiEQCkAwAMAADwAQA+AAL4BxH9SF8G+AcBRwAA9AkAtxcBqQEAGAAAOAAATwBi/gDyAPL3To0A9gsA",
	"nRsAvgMAzA0ACAARA6uTAMQXAlICIwQDCAARAfAxAEsAAAgAAF0IABwQEPwAVgBxAAAWAkIFAP0E2wkA7j8AjAABAAIQ+/wBAA84",
	"MAf5ABYCAK4EABgADwQA5gHdAQasAQP+AQEGAAGQJwEKAAIFAAMiAAIMAAELAAIRAAAGAAH4BwB4AQLwDwATAAAbAAAgAAIgBAM9",
	"AAUNABEC5CdgAO769/gA8DMB9wMQAAZQAdTBAA4AATAiAAcEAORxAAgAANwXAGgAAV0CBAQAAFcAAAgABAQAAQcAACoAAfABABMA",
	"AxYAAOITAP4nAAwAAQRUAAsCAA0ADwQA6ALMAQEEAABIAQn+AQCDAQEKAAIQAALAAQILAAEEAAHUDwIqDgAbAAFaywTwDwUgAAAa",
	"AAAIAAEmAABIsQIECgFRUwD0DxDwdDsBVAAA7HcALgAABAAQACoUAagpEPpoBAEMHhH99CkBWAAANSIA5A0ADAAAEAoAFQACcwQF",
	"6wEE/g0EBgABBAAR/PsPAfYJIvkHCwAPBADqAXgBAwQAAXcBAxEAANQVCxAAAGsBBAoAAQQAASAABP4BAodHAR4AAlYBAKgFAJYB",
	"AAwAABYAAAgAAB4EAgwAoP0C/f/59QD19vDoLQASAAJFAAIEAAIYPAAMAABUBgAIAAH/AQERCgAgAAEVHACTZQDkhwB4BAEVAACB",
	"AAXrAQD+AQARAAEMBAEeAAAWAAAJFAIVBAD/DwIKAA8EAO8AHgEABAAE3QEADAAABAAIEAAAs4EDsQ8AkAMACAABHQABuI8R+rFt",
	"AKwFAHMBAIQBACAAAAQABAwAAEQAAEcAAfwDAJQBgAIA7gEA8fL7EwIAsA8SAOx3AJ4pAAgGADQAABAAAGQAAAgAADwAAGgCANQD",
	"AAgGAN8XACgAAIMAACQAAQwQIAQAC3wA7BMhAATSHxEBAAoAPAAABgIALBBB+QEBAf8tIQf5WCAAaAIARAAPBADpAFgBAAgAA+4B",
	"BKsBC/4BAQkAAJwtABAAAL8TAhYAAZQDAK8DAckBAJc5ABgAARsAAgQAAMoBAAgAAA0AAAwAAfgXEPc8zUDxAPLygdMDACYAxwUR",
	"/YxXARBKAQAMABsAAQgAABAKAEIAAGACAQgABAQAAQUAAAlSANs3AgIGAxkAAQ0AA90bAAsAI/wECwAB9wUAaAABDQAPBADwAS8B",
	"A+4BAAQACBAAAgwAAQYAAREAAAoAASECASwzAQYUAEULAAkAAqwFAiUAAhcGAvwDADMAAA4AAAwAAfwNgfcB+PgC7gD25CcBLwAA",
	"/E0B0QsAl0EAvisANAAAEAAICAABYgIBShQA8AEAHgwB7gEACAYA4AEADQAADAAA4okA6AUAJQYj/ATzAQAsCAERAgBlIAD4FwAV",
	"AA8EAPQAXAEAzQEADAAABAAIEAAADAAABAAEEQADiwEBJBYA9AEAFAAAXyMAEAAB6BcBxgcC1AEENAAEDAAAbwcAvgGC+QD4+u8B",
	"APCcDQDJIQC/DQDDBwAeAAClAQEmbgERBgEiAAAEjgAACAAbAAHgLQsAEgAFABABsI0ADQAGGAIA9RsACQAARAAQ+2QEBA0AAP4J",
	"AQgADwQA7wBNEwCkEQDAAQA5AQAEAAD0DQC6AQG3AQKYBwEKAAAUAABDAQEsAAH0BwDgAwIIAACXAwAgAAMgAgGBAQQEBAMMAAAL",
	"AACUAwDyDwBlYwD/ARD9iwcAKAAAhqUAAgIC8A8Ama8R+VQIANAPAAAIBfgHA5AAAIkGAMcFAPwXMAUABPgHAQwAIAQA6FcAZhAA",
	"DAgBZdAR+wQIAPEPAAAGEAFdPgD6BwGPAA8EAO4AoQEBpg0BqwEABAACZQEKBgADCQAABAAADwADiQEA5QEBCAADcQMAJgAATAIC",
	"HQAADgAACAAGDQARBHkHANwtM/EA+ywGABIAAAgAAI8HADwCAAwAAAgAAOQBA2cAAOALAmEAAQ4AAgQAAAQoAFYAACQAABwaAwwA",
	"AwUAAARgAQgAAPEPABMAAQYGAAguQAQA+wEICgAQAA8EAPMAagEBUwEBBAAAqAUAcHMBDAABBQAAIAAAkgECDAABXwEAGAAAUgEA",
	"CAAATJMBCAAC6BcCwgUAmGUAVgIIDAACuAMg8gDORRDzNQwAHAABAAQACyQAlw8A0AsCAAQE8BcAMgAC+QUARAAAIQoAqgAGbwIA",
	"BAAAFgAEDwAACAAC5gcA8AcCEgAA+FMACgABDQAAGwADDQAPBADzAWIBAQQAAqwBBQUAAHUBAwsAA/4BAQwAAEYBAJAXAIQBAAgA",
	"AHIBAPQBAAQGAwgAAOwVAA8GAQwAACQAAEAAARgEMAD6+wACAEVrAJUdAOwVBAAECAgAAGkAAF8CAAgAAIIAAEAAAAACANQnAAwA",
	"AsUBAC4AATQAAgkAAJkABQQABRMAAA0AAPYFAREAABwAAAgADwQA/wECiEUFBAABhAMACQAAxAEAGq0CDAAB4BcAFQIC9AcAl50A",
	"OAAADAAAvwEAYAECDAAAlAMCLAAA3AcSA3I5EADgIUDxAPj45gEAwAcT/uRrABgKAPABAA0AAAgAAAAMAQgAA98BAE4AAMobACAE",
	"AF4AACQCAfAPAhsMAQkKEgRDDAHwAQAgAAD5BwANAABYBgATAgAIDABwAgIYAABGAA8EAPMCLAECBAAAjAEABAAADAAANAEG3AEA",
	"fhMBDAAR+6APAuAXAJ0BAB0AAKMBAggAAQQAAUIAAQUAABQCAAQAAmQAU/EA9QDw/gEAFgAASAIAGAAh/QB06QIyAAHwAQB8AAAI",
	"AACqAQBoBADkBwAMAAJxAAEFAAHbCwHsNQApAAASAAMXAAMEAAMHAABCHAILAAAWBgIAAg8EAP4Q++QBAGAFAPgLALwfABAAAFcB",
	"ADsRAQwAAIUBAwwCAzZhAosBAgsAACsAAZSLAL0BAZdpIAD+nxcDJjgBSwQQ+DbFEPPKUQAyAAB7OTD+AAAoGAAKAiL9AadnAOQB",
	"AEQGACMAAEwAAPwLAeQBAEcAABEAAMkBAB0AAAQAANEBAGAAABwAAAgAAEEAACwAAAQAAFUAABRiAQQWAP8BA0gAADgADwQA/ABo",
	"BQRXAQBLARD+LgcD7AEIDAAACwAACAAAKwAABAAADAAAMAAABAAA4QEAzgMAEBAECVQAGgIACQgAKABRAPj6APP4CwJrJwCLWxID",
	"qocBdIkAlx8A8RsAFAAAxQUAlN0A0wEAaAAAzg8AUhAAXAAAEAAAzgEAYAAAEAAAfAAAmwIA5gEADAABEwIBVwAF9AMAFwAACAAB",
	"BAAAOAAPBAD9AOIBAKQBACkBAyQBQfkGAPecMwAYAAA2LwIMAAIUCAIUAAEutQEJAAHgBwMYCAIEAALCAwIMAAFoGwH4BzDyAPZM",
	"cwBYqwC7BwEHFAB8AABUAAAIAAA8DACEBADnAwDQAQBnBgAIAABNAADgBwAAEAAsAAAyCADkPwBAAABqAADUBQAsAAAoADEEAPxL",
	"BgCYAAAUAAA0AAD4AwAkAAAUAA8EAP8CADABEf8ERQHHBQHIAQAwKQMYAAEUAAMMABH6TAEAoQEAOQADCCIANgAAJAAAKQABEAAB",
	"DQACgAMCeAEw7wD2+AcAUVsC4AsATwABAAIAKwAAOAYARAAgAf0oDgPECQMFAADUCQBKAAGYAgEFAAD3BwASAAcMAAEsAAAQFgBy",
	"AAIMAAA4BgIKAAEUAABAcgAPAA8EAP8DAHwDALgBADADAAgAAAQAAFMBAJwHAAwAACAAAFUDAAwAACQAAJgBABQAALADABQAABUE",
	"ADAAAJwDABAAAAgAABAAABACAOwFIfMApIsBuGcAQAIAIAAAHAAAaAgA1AsAogEAyAMAPAAEOAAICAQAwQEAFQAAMiACDAAABgAB",
	"IAAC4gEB6i0A17sCHAABDgAAMQACDwACBAAADAAPBAD/BQDMAQB8AQCZAwAQAAAMAAErqwJZ1QATAAUmNQAcAANfBwFWAQIQAAAE",
	"ABH8kHUGEAABgQFi/QD1APf3AAIBFQAAkwcAc18gAgDAxQCbARL+0TUAMAoAIQAG+AEBCQAAIgAAcAAA7AcCEAAABQABDxICKQID",
	"4wEACwAAJAgADAAABAAAEAAALgAADAAABAAADAAPBAD/BgCkAwAIAAG8AQBkrwAIAAHwBQBsAQLkBQAEAARxAQIEBAAgAAIQAAAG",
	"AAAgAACWAQAIAABwAQEiAmAAAO39APADAgGQxwATAAA8AAPZARD99AkCCgAC4gEAlBUA/QUCIAAAegwC4C8AJ0gAUAAANQYgBACe",
	"lwLpDzADAQQPZgHODwAcAAIAHgBMAABkBgCGAAATgAA8yABlAA8EAP8KAHABAugBAI4BADQJABYAAYcBAbwVBhwAAAUABAgAAPgJ",
	"ACcCABwAAAwGABgAAuQTAgQAABevEPBmiQK0ZxD96B8BCgABBAAALgADBAAC9AMEDQACBgABBQABEgACyQEABMoA8BEBDgAA+yMC",
	"9wMAIgAADAoADAACMwAAFwAABAAAUFYAPwAAFAAPBAD/DABMAwAIAABMAQAIAAI+AQAKAALpBQCQBQTYAQARAAAEAAAPAADcFQAU",
	"AAAEAAAkAAMIAAAHABEAIdUQ7QcAAUpbASwMAOYBAigAEv4sEAA1AgBNAAIyAAD0BQEeAAPaAQBjAAMLAAACDgELAAAUAAAMGgAI",
	"AAFuAAAYFABUCAAmAAIKBgL+BwAhAAAEAAIYAA8EAP8MASgBBJIrAAQAAREAAkgFAAoAAA8AAB8AAG8fABAAAHgBAAgABTAAAAQA",
	"ACUAASwEwP0AAvv9/vrzAPQB7ToOAIwFBFEYAekHAQsAAAkaAMBfABYAABEAAckLAcMLAPwrAdjjARsAADkAAPQXBNQBAQUAAAQA",
	"AAkAEQEQHhL+8gEE/gECBQAATwACQAAPBAD/EAFPAQDcJwBUAQI/AQISAANzAQCwAQToBQERAAKcWwDMLwPgEwH0GQDHAQEeAHDw",
	"AADt+gD1y0EAa08BIgADSwACRgoCCwAQ/QAYA9cBEP39AwAJAAOMCAAPAAEoEgIfAAAGAgAXAAHUMQOnCgDuAQJQHAIQAAD+CQAI",
	"AAAZMAAIYAEMAA8EAP8YAJAFAwgAAOwBAIANAPABAxAAAeABAx0AAAUAAQwCABAAAAgAABEAABkAAgQAEO/JORDvvQECM28CHgAA",
	"XwAA9AUANAACBAAAFgACCQABBQABtwEIEAAFBgAQ/QAKAgsAABIAAfgBAQUAAhIAADgAARAIBrkCBAgADwQA/xcBSQEFYgEH1AEA",
	"BwAB7QMEDQAABAAAIAAEEAACBQAEIgAAKn0Q8MI9AeQZAXkhACcAACQAAAECA+gJAKoDAAwCAeUDA9gJAB8AAA8AAEYAASUAAPIp",
	"A2QAABwAAAgAAg4AAEJGAPR1AEc0AfoFABUAARQwAA0GBPgRDwQA/xoAQQEAWwEA0AkArB8AFAADEAAFBAAEFAAGDQACEAAADwAA",
	"BABQAPz8/v0jkQD+AwGffwT9AQDMBwG+DwIFCAD9AQEYAADSJQDwBwB+AAIYAgIFAAMcAAILAAANAAIIAAIcCAHdAQJEDgEEAAEo",
	"CABeAACeHAAdAAAEAAAkAA8EAP8aAMABBDgBAqIJBksFAA8AAvwLAeQHBfQHAOgvADgAABoAAIQHEfB5yVD1APMA+sxrAfwBA6cB",
	"AgwAAQoAAdwJAAkAAA4AALxXANQBAAwAAfIBASgAAiYCAQQAAgAIAkQAAAyGAAQeAAwAABEAAIgAAKsIAwwAAa8AAAQEAnAWDwQA",
	"/x0ARQEBlj8B5AEEtwEABAABCQAAgAUA9wEC8AEBJAAGMw5RAADzC+/VHSDvBh/fAj4AAB8AAQQAANwFARIAAA0AADAAAaoBAPYV",
	"AM4VAbwBBR8AAOAvAQsAAxQGABQAAA8AACEAABgAAAQAAiwABOgrA1EGABMAAhAADwQA/yMAQAUDCAAE1DEA5QMBhAMADwAAGAYC",
	"FQABJAABBAACDgAgAPgW+xL6/QMT8CR5AdAdACQAAFgAACkCA0ACABwAAKYBAdAJAGgAAL0BAPQBAB4AAAwAAhYCAKIpACsAABIA",
	"A+gHAAQAE/kSCAFNAAAJAAAVAAEpOgQMAg8EAP8nAegBAgACAb4nCAQIAAcAAvgDAgQAA8kBAITRAF1jEPvoDQD9AwDzBwD/AQLE",
	"BQDOFQI/AgAQAADQBwAcGAAEAAG/AQC5NQHyFQAEAALNLQAkAADEBwA1AAIQGAA4CAEIAAAEAADkJQBYAgFQAgAQEAGIAAD5HwAF",
	"BgAMAA8EAP8rAk4BBOgBApYBCAQIAQ8EAcgfAKABABIAAJwHAOoLEfoaywDaGwNAKANIeQALAAC+AQPMKwFRAAAgAAQAAhL3+gUA",
	"HAAAByoBDgAAIAACzA8BBAgBmIMCDgACXAAABAAAGFIBQwABBAAP4Bf/Fg8EAAsClAEACgACCQABCAIACQAACAADYwcAENkA2AUA",
	"EwAA2BcA8gEAxi0S/u4BAT91ACgAAEgCAwQAABgAAK8DAg0AA9kBAgwAAO4BAqAXAUwoANgXA2gAADsAADQCACcAABEAAFzjAAwA",
	"ABwAABQIAAgABpoCBAgADwQA/ywAVAEAXAMABAAADAAA8AcABAYABBIEzAEA8AEAxR1T+gAA8gnYFTH3APFAOwECAgLpBQAKAAHK",
	"AQCsAQANAAD3AQDnFwDlLwAs/QBOAADaPQPyYRD9DAAAOQACbAAAl1cB2xsDNRYASgACCwAA/AcB7gEBBQAABAAFCQAPBAD/LwD4",
	"AQAIAACCAQF6BQOEDQJ+AQGIBxD7qC0A7ANT/ADzAPYAAgDzAQH8ASIA+zAgAQwAAvgPA0MAABEAEPvECQB2ZwANAAEUCgAwAAUE",
	"CBD7aCYT/vQHAXynABMEAAwyAAQoAeYBEfsrMgFQAAEQAA/0B/8zBgQAAHABAAgAAPgFAAwAAGkBANAFAAgAAHwDAOQBAAtxAGqz",
	"AAwABAgAADQABAgAASoCBxgAAAwKAAgAAAQAABwAABQCAAQABCAAAFwAAGxjBAwABDAAAuAHAgQAEP6V+QBcKAAbAgBFAADTnwIY",
	"6gAfAA8EAP9QEuTQAQQEAACkAQAQAgAIAAEM0yPyAGDxACKJAKUBABAAYPUACwAA9UACADYAEgg5iyAAAzEEAKwRQfcAAAk+BANx",
	"KAM3BgBYAAApAAAMAAM8BgAzBgAYCgHrAwITAA/4A/88BAQAALfyAAgAAGQBAIgBAAgAMQAA5ZgBAPgBAK4BAAgAAMADABQAACQA",
	"APgBAOMfQAkAAPXwAQBAAAAYAATMAxAFMQAQAAAgABoAAuQBAAoAABcAAAQAAAwAAQAYBSUYABIAAggAAAQAABcEAOwBBAQAABgG",
	"AiIADwQA/0AQ1AUABPRuA+wDBJQBAAwAABgAAAgAAx8AAQQABBAAAAulAPABAAwABBQACAQAADwAAAgABAQADCQAAAMCCCQAABAA",
	"AAgADwQA/1oT1vQBAAwADAgACJwBDwQABQQsAA8EAA8C7gsACgAIBAAAaAIACAAPBAABDPgDD+wP/y4PBAABE9rsAwAMAAAIAA+k",
	"AQEPBAAFAlRxAAoACgQAD6gBEQBsAAB5AA8sABEPBAD/SgDQEQAIAAQEAAAYewAIAAAEAA/cAxEIMAIAEBAACAAPBAARAQACDwQA",
	"////cwy0AwiYAwwcAAwEAAAsAA8kAAEAGAAACAAPBAAJD/gF/24PBAD//////////////////wMA"
].join("");
function decodeBase64Bytes(encoded) {
	const binary = globalThis.atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
function readExtendedLength(source, state) {
	let length = 0;
	let value = 255;
	while (value === 255) {
		if (state.offset >= source.length) throw new Error("[BAClickFX] Trail texture LZ4 length overflow");
		value = source[state.offset++];
		length += value;
	}
	return length;
}
function decodeLz4Block(source, outputLength) {
	const output = new Uint8Array(outputLength);
	const state = { offset: 0 };
	let outputOffset = 0;
	while (state.offset < source.length) {
		const token = source[state.offset++];
		let literalLength = token >> 4;
		if (literalLength === 15) literalLength += readExtendedLength(source, state);
		if (state.offset + literalLength > source.length || outputOffset + literalLength > output.length) throw new Error("[BAClickFX] Trail texture LZ4 literal overflow");
		output.set(source.subarray(state.offset, state.offset + literalLength), outputOffset);
		state.offset += literalLength;
		outputOffset += literalLength;
		if (state.offset === source.length) break;
		if (state.offset + 2 > source.length) throw new Error("[BAClickFX] Trail texture LZ4 offset overflow");
		const matchDistance = source[state.offset] | source[state.offset + 1] << 8;
		state.offset += 2;
		if (matchDistance <= 0 || matchDistance > outputOffset) throw new Error("[BAClickFX] Trail texture LZ4 offset is invalid");
		let matchLength = (token & 15) + 4;
		if ((token & 15) === 15) matchLength += readExtendedLength(source, state);
		if (outputOffset + matchLength > output.length) throw new Error("[BAClickFX] Trail texture LZ4 match overflow");
		const matchOffset = outputOffset - matchDistance;
		for (let index = 0; index < matchLength; index++) output[outputOffset++] = output[matchOffset + index];
	}
	if (outputOffset !== output.length) throw new Error("[BAClickFX] Trail texture LZ4 output is incomplete");
	return output;
}
function paeth(left, above, upperLeft) {
	const prediction = left + above - upperLeft;
	const leftDistance = Math.abs(prediction - left);
	const aboveDistance = Math.abs(prediction - above);
	const upperLeftDistance = Math.abs(prediction - upperLeft);
	if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
	if (aboveDistance <= upperLeftDistance) return above;
	return upperLeft;
}
function decodePaethTexture(encoded, outputLength, channels) {
	const residual = decodeLz4Block(decodeBase64Bytes(encoded), outputLength);
	const output = new Uint8Array(outputLength);
	const stride = 512 * channels;
	for (let y = 0; y < 512; y++) for (let x = 0; x < stride; x++) {
		const offset = y * stride + x;
		const left = x >= channels ? output[offset - channels] : 0;
		const above = y > 0 ? output[offset - stride] : 0;
		const upperLeft = y > 0 && x >= channels ? output[offset - stride - channels] : 0;
		output[offset] = residual[offset] + paeth(left, above, upperLeft) & 255;
	}
	return output;
}
const TRAIL_TEXTURE_RGB = decodePaethTexture(PACKED_TRAIL_TEXTURE_RGB, TRAIL_TEXTURE_RGB_LENGTH, TRAIL_TEXTURE_CHANNELS);
const TRAIL_TEXTURE_COVERAGE = decodePaethTexture(PACKED_TRAIL_TEXTURE_COVERAGE, TRAIL_TEXTURE_COVERAGE_LENGTH, 1);
function createTrailTextureRgba(rgb, coverage) {
	const pixelCount = 262144;
	const rgba = new Uint8Array(pixelCount * 4);
	for (let pixel = 0; pixel < pixelCount; pixel++) {
		const sourceOffset = pixel * TRAIL_TEXTURE_CHANNELS;
		const outputOffset = pixel * 4;
		rgba[outputOffset] = rgb[sourceOffset];
		rgba[outputOffset + 1] = rgb[sourceOffset + 1];
		rgba[outputOffset + 2] = rgb[sourceOffset + 2];
		rgba[outputOffset + 3] = coverage[pixel];
	}
	return rgba;
}
const TRAIL_TEXTURE_RGBA = createTrailTextureRgba(TRAIL_TEXTURE_RGB, TRAIL_TEXTURE_COVERAGE);
//#endregion
//#region src/webgl2-effect.js
const COMPONENTS_PER_VERTEX$1 = 6;
const COMPONENTS_PER_DISK_VERTEX$1 = 8;
const COMPONENTS_PER_RING_VERTEX$1 = 9;
const COMPONENTS_PER_TRIANGLE_VERTEX = 9;
const COMPONENTS_PER_TRAIL_VERTEX = 9;
const INITIAL_VERTEX_CAPACITY = 4096;
const MAX_PYRAMID_LEVELS = 16;
const DISK_CENTER_RADIUS_EPSILON = 1e-5;
const DISK_TEXTURE_RADIAL_STOPS = Object.freeze([
	[
		0,
		1,
		1
	],
	[
		.84,
		1,
		1
	],
	[
		.88,
		1,
		1
	],
	[
		.885,
		.356400144,
		.127021063
	],
	[
		.89,
		.171441101,
		.029392051
	],
	[
		.895,
		.102241733,
		.010453372
	],
	[
		.9,
		.063010018,
		.003970262
	],
	[
		.905,
		.015208514,
		231299e-9
	],
	[
		.91,
		.005181517,
		26848e-9
	],
	[
		.915,
		.001517635,
		2303e-9
	],
	[
		.92,
		0,
		0
	],
	[
		1,
		0,
		0
	]
]);
const EMISSION_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec3 a_color;
layout(location = 2) in float a_coverage;

uniform vec2 u_displaySize;

out vec3 v_color;
out float v_coverage;

void main()
{
  vec2 normalized = a_position / u_displaySize;
  gl_Position = vec4(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0
  );
  v_color = a_color;
  v_coverage = a_coverage;
}
`;
const EMISSION_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_color;
in float v_coverage;
uniform bool u_transparentOverlay;
out vec4 outColor;

void main()
{
  float coverage = u_transparentOverlay
    ? clamp(v_coverage, 0.0, 1.0)
    : 1.0;

  outColor = vec4(max(v_color, vec3(0.0)), coverage);
}
`;
const FULLSCREEN_VERTEX_SHADER$1 = `#version 300 es
precision highp float;

out vec2 v_uv;

void main()
{
  vec2 positions[3] = vec2[](
    vec2(-1.0, -1.0),
    vec2(3.0, -1.0),
    vec2(-1.0, 3.0)
  );
  vec2 position = positions[gl_VertexID];

  gl_Position = vec4(position, 0.0, 1.0);
  v_uv = position * 0.5 + 0.5;
}
`;
const PREFILTER_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_sourceTexel;
uniform float u_threshold;
uniform float u_softKnee;
uniform float u_clampMax;

in vec2 v_uv;
out vec4 outColor;

vec3 thresholdColor(vec3 color, out float transportEnergy)
{
  float clampMax = min(max(u_clampMax, 0.0), 65504.0);

  color = min(color, vec3(clampMax));
  float brightness = max(max(color.r, color.g), color.b);

  if (brightness <= 0.0)
  {
    transportEnergy = 0.0;
    return vec3(0.0);
  }

  float threshold = max(0.0, u_threshold);
  // BaGameBloomRendererFeature 的序列化范围是 0..1，并无条件加 epsilon。
  float knee = threshold * clamp(u_softKnee, 0.0, 1.0) + 0.00001;
  float soft = brightness - threshold + knee;

  soft = clamp(soft, 0.0, knee * 2.0);
  soft = soft * soft / (knee * 4.0);

  float contribution = max(max(brightness - threshold, soft), 0.0);

  // contribution 等于 Bright Pass 的最大通道。作为独立标量经过相同的
  // 正权重 Bloom 核后，它始终是三个 RGB 通道的上界。
  transportEnergy = contribution;
  return color * contribution / max(brightness, 0.0001);
}

void main()
{
  vec4 sampleSum =
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, -1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, -1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, 1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, 1.0));
  vec4 filtered = sampleSum * 0.25;
  float transportEnergy = 0.0;
  vec3 brightPass = thresholdColor(filtered.rgb, transportEnergy);

  // sourceTarget.a 仍保留清晰 Scene Coverage；Bloom RT 的 Alpha 从
  // Prefilter 开始仅传输 Bright Pass 上界，不从最终 RGB 反推。
  outColor = vec4(brightPass, transportEnergy);
}
`;
const SCENE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_color;
in float v_coverage;
uniform bool u_transparentOverlay;
out vec4 outColor;

void main()
{
  // Scene 模式保留 Unity 固定 A=1；透明覆盖层单独保存粒子 Coverage。
  float alpha = u_transparentOverlay
    ? clamp(v_coverage, 0.0, 1.0)
    : 1.0;

  outColor = vec4(max(v_color, vec3(0.0)), alpha);
}
`;
const SCENE_BACKGROUND_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_background;
uniform vec2 u_uvScale;

in vec2 v_uv;
out vec4 outColor;

void main()
{
  vec2 uv = (v_uv - 0.5) * u_uvScale + 0.5;

  // DOM 栅格源统一按左上原点上传；Shader 翻转也覆盖忽略 UNPACK 的 ImageBitmap。
  uv.y = 1.0 - uv.y;
  // SRGB8_ALPHA8 采样会自动解码到线性空间，和 Unity 相机颜色 RT 一致。
  outColor = vec4(texture(u_background, uv).rgb, 1.0);
}
`;
const TRIANGLE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec3 a_materialColor;
layout(location = 3) in float a_particleAlpha;
layout(location = 4) in float a_coverageFactor;

uniform vec2 u_displaySize;

out vec2 v_uv;
out vec3 v_materialColor;
out float v_particleAlpha;
out float v_coverageFactor;

void main()
{
  vec2 normalized = a_position / u_displaySize;
  gl_Position = vec4(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0
  );
  v_uv = a_uv;
  v_materialColor = a_materialColor;
  v_particleAlpha = a_particleAlpha;
  v_coverageFactor = a_coverageFactor;
}
`;
const TRIANGLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform bool u_transparentOverlay;
uniform bool u_alphaModulatesEmission;
uniform bool u_antialiasGeometryCoverage;
uniform bool u_roundTriangle;

in vec2 v_uv;
in vec3 v_materialColor;
in float v_particleAlpha;
in float v_coverageFactor;

out vec4 outColor;

float sdTriangle(vec2 point)
{
  const vec2 vertices[3] = vec2[](
    vec2(-0.9609375, -0.7265625),
    vec2(0.9609375, -0.7265625),
    vec2(0.0, 0.9140625)
  );
  float minimumSquaredDistance = 1.0e20;
  bool inside = true;

  for (int index = 0; index < 3; index++)
  {
    vec2 start = vertices[index];
    vec2 end = vertices[(index + 1) % 3];
    vec2 edge = end - start;
    vec2 offset = point - start;
    float progress = clamp(
      dot(offset, edge) / max(dot(edge, edge), 1.0e-20),
      0.0,
      1.0
    );
    vec2 nearest = offset - edge * progress;

    minimumSquaredDistance = min(
      minimumSquaredDistance,
      dot(nearest, nearest)
    );
    inside = inside && edge.x * offset.y - edge.y * offset.x >= 0.0;
  }

  return sqrt(minimumSquaredDistance) * (inside ? -1.0 : 1.0);
}

float sdRoundedTriangle(vec2 point, float roundness)
{
  if (roundness >= 1.0)
  {
    return length(point) - 1.0;
  }

  float triangleScale = max(1.0 - roundness, 0.000001);

  // 缩小真实图集三角与圆盘的 Minkowski 和只磨圆角，仍保留直边。
  return sdTriangle(point / triangleScale) *
    triangleScale - roundness;
}

void main()
{
  float roundness = u_roundTriangle
    ? clamp(v_coverageFactor, 0.0, 1.0)
    : 0.0;
  vec2 sampleUv = v_uv;

  if (u_roundTriangle)
  {
    sampleUv = (v_uv * 2.0 - 1.0) /
      (1.0 + 1.16465 * roundness) * 0.5 + 0.5;
  }

  vec4 sampleColor = texture(u_texture, sampleUv);
  float particleAlpha = clamp(v_particleAlpha, 0.0, 1.0);
  float geometryCoverage = 1.0;
  vec2 point = v_uv * 2.0 - 1.0;
  float distance = sdRoundedTriangle(point, roundness);
  float footprint = max(fwidth(distance), 0.000001);
  float roundedCoverage = 1.0 - smoothstep(
    -footprint,
    footprint,
    distance
  );

  if (u_roundTriangle && roundness > 0.0)
  {
    float textureSupport = clamp(sampleColor.a, 0.0, 1.0);
    vec3 supportedRgb = mix(vec3(1.0), sampleColor.rgb, textureSupport);
    vec3 shapeRgb = mix(supportedRgb, vec3(1.0), roundness);

    // 正数圆角只有一条 Coverage 边界；RGB 在透明区向材质色外推，
    // 再随比例淡化纹理细节，避免形成“圆里套三角”的暗边。
    sampleColor = vec4(shapeRgb, roundedCoverage);
  }

  if (u_transparentOverlay && u_antialiasGeometryCoverage)
  {
    float edgeDistance = min(v_uv.y, 1.0 - v_uv.y);
    float halfPixelFootprint = max(fwidth(v_uv.y) * 0.5, 0.000001);

    geometryCoverage = smoothstep(0.0, halfPixelFootprint, edgeDistance);
  }

  float coverageFactor = u_roundTriangle
    ? 1.0
    : clamp(v_coverageFactor, 0.0, 1.0);
  float coverage = sampleColor.a * particleAlpha *
    coverageFactor * geometryCoverage;
  // sRGB 纹理采样会自动把 RGB 解码到线性空间。
  vec3 emission = sampleColor.rgb *
    max(v_materialColor, vec3(0.0)) *
    (u_alphaModulatesEmission ? coverage : particleAlpha);
  float outputAlpha = u_transparentOverlay ? coverage : 1.0;

  outColor = vec4(emission, outputAlpha);
}
`;
const SCENE_DISK_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec3 a_materialColor;
layout(location = 3) in float a_particleAlpha;

uniform vec2 u_displaySize;

out vec2 v_uv;
out vec3 v_materialColor;
out float v_particleAlpha;

void main()
{
  vec2 normalized = a_position / u_displaySize;
  gl_Position = vec4(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0
  );
  v_uv = a_uv;
  v_materialColor = a_materialColor;
  v_particleAlpha = a_particleAlpha;
}
`;
const SCENE_DISK_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform float u_emissionScale;

in vec2 v_uv;
in vec3 v_materialColor;
in float v_particleAlpha;
out vec4 outColor;

void main()
{
  vec4 sampleColor = texture(u_texture, v_uv);
  // Cross2 的 _RGBRGBA=0 读取线性 R 作为透明度，原图 A 恒为 1。
  float textureAlpha = sampleColor.r;
  vec3 color = sampleColor.rgb *
    max(v_materialColor, vec3(0.0)) * textureAlpha *
    max(u_emissionScale, 0.0);
  // 生命周期 Alpha 只控制目标颜色衰减，不能再次乘入源 RGB。
  float alpha = textureAlpha * clamp(v_particleAlpha, 0.0, 1.0);

  outColor = vec4(
    color,
    clamp(alpha, 0.0, 1.0)
  );
}
`;
const DISSOLVE_RING_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec3 a_materialColor;
layout(location = 3) in float a_dissolveThreshold;
layout(location = 4) in float a_coverageOpacity;

uniform vec2 u_displaySize;

out vec2 v_uv;
out vec3 v_materialColor;
out float v_dissolveThreshold;
out float v_coverageOpacity;

void main()
{
  vec2 normalized = a_position / u_displaySize;
  gl_Position = vec4(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0
  );
  v_uv = a_uv;
  v_materialColor = a_materialColor;
  v_dissolveThreshold = a_dissolveThreshold;
  v_coverageOpacity = a_coverageOpacity;
}
`;
const DISSOLVE_RING_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_materialColor;
in float v_dissolveThreshold;
in float v_coverageOpacity;

uniform sampler2D u_texture;
uniform bool u_transparentOverlay;
uniform float u_emissionScale;

out vec4 outColor;

void main()
{
  // Unity 在片元阶段以 Bilinear + Clamp 采样 Ring3，而不是插值顶点 Alpha。
  float textureAlpha = texture(u_texture, v_uv).r;

  // Unity clip(alpha - threshold) 是硬裁剪，通过的片元保留原纹理 Alpha。
  if (textureAlpha < v_dissolveThreshold)
  {
    discard;
  }

  textureAlpha = clamp(textureAlpha, 0.0, 1.0);
  vec3 materialColor = max(v_materialColor, vec3(0.0)) *
    max(u_emissionScale, 0.0);

  if (u_transparentOverlay)
  {
    // RGB 预乘纹理 Alpha 后改用 One/One，结果与 Unity SrcAlpha/One 相同。
    outColor = vec4(
      materialColor * textureAlpha,
      textureAlpha * clamp(v_coverageOpacity, 0.0, 1.0)
    );
    return;
  }

  outColor = vec4(materialColor, textureAlpha);
}
`;
const DOWNSAMPLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_sourceTexel;

in vec2 v_uv;
out vec4 outColor;

void main()
{
  vec4 sampleSum =
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, -1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, -1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, 1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, 1.0));
  vec4 filtered = sampleSum * 0.25;

  // Alpha 是 HDR 传输上界，必须与 RGB 使用同一线性核且保留大于 1 的值。
  outColor = filtered;
}
`;
const SCENE_OVERLAY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_scene;

in vec2 v_uv;
out vec4 outColor;

void main()
{
  vec4 scene = texture(u_scene, v_uv);
  float coverage = clamp(scene.a, 0.0, 1.0);
  float capacity = coverage <= 0.04045
    ? coverage / 12.92
    : pow((coverage + 0.055) / 1.055, 2.4);
  float maximumEnergy = max(max(scene.r, scene.g), scene.b);
  float scale = min(1.0, capacity / max(maximumEnergy, 0.000001));

  // 只把清晰 Scene 收敛到 authored Coverage 的预乘容量；原 HDR Scene
  // 仍保留在 sourceTarget，供 Bloom Prefilter 与已知背景精确合成使用。
  outColor = vec4(scene.rgb * scale, coverage);
}
`;
const UPSAMPLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_accumulatedCoarse;
uniform sampler2D u_currentFine;
uniform vec2 u_accumulatedCoarseTexel;
uniform float u_sampleScale;

in vec2 v_uv;
out vec4 outColor;

vec4 sampleBox(sampler2D source, vec2 uv, vec2 offset)
{
  return (
    texture(source, uv + vec2(-offset.x, -offset.y)) +
    texture(source, uv + vec2(offset.x, -offset.y)) +
    texture(source, uv + vec2(-offset.x, offset.y)) +
    texture(source, uv + vec2(offset.x, offset.y))
  ) * 0.25;
}

void main()
{
  vec2 offset = u_accumulatedCoarseTexel * (u_sampleScale * 0.5);
  vec4 accumulatedCoarse = sampleBox(u_accumulatedCoarse, v_uv, offset);
  vec4 currentFine = texture(u_currentFine, v_uv);

  // Unity 对 lastMip（累计粗级）继续扩散，再单点加当前细级。
  // RGB 与传输上界必须走完全相同的加法链，避免透明合成改变光晕轮廓。
  outColor = accumulatedCoarse + currentFine;
}
`;
const FINAL_FRAGMENT_SHADER$1 = `#version 300 es
precision highp float;

uniform sampler2D u_scene;
uniform sampler2D u_sceneEnergy;
uniform sampler2D u_bloom;
uniform sampler2D u_background;
uniform vec2 u_bloomTexel;
uniform float u_sampleScale;
uniform float u_intensity;
uniform float u_overlayAlphaLimit;
uniform float u_opacity;
uniform bool u_hasScene;
uniform bool u_hasBackground;
uniform bool u_transparentOverlay;
uniform bool u_visualMaxAlpha;
uniform bool u_brightUnknownBackground;
uniform bool u_hostAdditive;

in vec2 v_uv;
out vec4 outColor;

float linearToSrgb(float value)
{
  float linear = clamp(value, 0.0, 1.0);

  if (linear <= 0.0031308)
  {
    return linear * 12.92;
  }

  return 1.055 * pow(linear, 1.0 / 2.4) - 0.055;
}

float solveOverlayAlpha(float background, float target)
{
  if (target > background)
  {
    return (target - background) / max(1.0 - background, 0.000001);
  }

  if (target < background)
  {
    return (background - target) / max(background, 0.000001);
  }

  return 0.0;
}

void main()
{
  vec2 offset = u_bloomTexel * (u_sampleScale * 0.5);
  vec4 bloom =
    texture(u_bloom, v_uv + vec2(-offset.x, -offset.y)) +
    texture(u_bloom, v_uv + vec2(offset.x, -offset.y)) +
    texture(u_bloom, v_uv + vec2(-offset.x, offset.y)) +
    texture(u_bloom, v_uv + vec2(offset.x, offset.y));
  vec4 scene = u_hasScene
    ? texture(u_scene, v_uv)
    : vec4(0.0);
  vec4 sceneEnergy = u_hasScene
    ? texture(u_sceneEnergy, v_uv)
    : vec4(0.0);
  vec4 filteredBloom = bloom * 0.25;
  vec3 sceneLinear = scene.rgb;

  if (u_transparentOverlay && u_visualMaxAlpha && !u_hostAdditive && u_hasScene)
  {
    // visual-max 要恢复 v1.2.15 的颜色保留，必须读取未提前按 Coverage
    // 收敛的清晰发射；sceneOverlay 只供默认 Coverage 合同使用。
    sceneLinear = sceneEnergy.rgb;
  }

  vec3 linear = sceneLinear +
    filteredBloom.rgb * max(0.0, u_intensity);
  vec3 srgb = vec3(
    linearToSrgb(linear.r),
    linearToSrgb(linear.g),
    linearToSrgb(linear.b)
  );

  if (u_hasBackground)
  {
    vec3 backgroundLinear = texture(u_background, v_uv).rgb;
    vec3 backgroundSrgb = vec3(
      linearToSrgb(backgroundLinear.r),
      linearToSrgb(backgroundLinear.g),
      linearToSrgb(backgroundLinear.b)
    );
    vec3 difference = abs(srgb - backgroundSrgb);

    if (max(max(difference.r, difference.g), difference.b) <= 0.00001)
    {
      outColor = vec4(0.0);
      return;
    }

    // 求满足 target = premultiplied + background * (1 - alpha) 的最小
    // source-over Alpha；这样 DOM 背景保持可交互，同时逐像素等于 Unity 输出。
    vec3 channelAlpha = vec3(
      solveOverlayAlpha(backgroundSrgb.r, srgb.r),
      solveOverlayAlpha(backgroundSrgb.g, srgb.g),
      solveOverlayAlpha(backgroundSrgb.b, srgb.b)
    );
    float overlayAlpha = clamp(
      max(max(channelAlpha.r, channelAlpha.g), channelAlpha.b),
      0.0,
      1.0
    );
    vec3 premultiplied = srgb - backgroundSrgb * (1.0 - overlayAlpha);

    outColor = vec4(
      clamp(premultiplied, vec3(0.0), vec3(overlayAlpha)),
      overlayAlpha
    );
    return;
  }

  if (u_transparentOverlay)
  {
    float sceneCoverage = u_hasScene
      ? clamp(scene.a, 0.0, 1.0)
      : 0.0;
    float bloomTransportAlpha = linearToSrgb(
      max(0.0, filteredBloom.a) * max(0.0, u_intensity)
    );
    float requestedAlpha = u_visualMaxAlpha
      ? max(sceneCoverage, bloomTransportAlpha)
      : sceneCoverage + bloomTransportAlpha;
    // Canvas lighter 与默认帧缓冲都会先把累计 Alpha 饱和到 1。Bloom
    // 强度较高时 requestedAlpha 可大于 1；继续用未饱和值归一化会在
    // 预乘容量已经充足时额外压暗 RGB，并与 Canvas 回退产生跳变。
    float transportCapacity = min(requestedAlpha, 1.0);

    if (u_hostAdditive)
    {
      // CSS/原生宿主使用 One/One 加色时不会以源 Alpha 衰减背景。Alpha
      // 仅承担浏览器预乘传输，至少覆盖 RGB，不能再反向限制发射能量。
      float maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);
      float transportAlpha = clamp(
        max(maximumSrgb, transportCapacity),
        0.0,
        1.0
      );

      if (transportAlpha <= 0.00001)
      {
        outColor = vec4(0.0);
        return;
      }

      outColor = vec4(srgb, transportAlpha);
      return;
    }

    float alpha = min(
      transportCapacity,
      clamp(u_overlayAlphaLimit, 0.0, 1.0)
    );

    if (alpha <= 0.00001)
    {
      outColor = vec4(0.0);
      return;
    }

    // 默认合同按独立传输和收敛；visual-max 只在最后一步读取 maxRGB
    // 约束预乘容量，不能用颜色反向生成 Coverage Alpha。
    float maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);
    float capacityScale = u_visualMaxAlpha
      ? min(1.0, alpha / max(maximumSrgb, 0.000001))
      : min(1.0, alpha / max(transportCapacity, 0.000001));

    vec3 premultiplied = srgb * capacityScale;

    if (u_brightUnknownBackground)
    {
      float safeOpacity = max(u_opacity, 0.000001);
      float normalizedCoverage = clamp(alpha / safeOpacity, 0.0, 1.0);
      float maximumPremultiplied = max(
        max(premultiplied.r, premultiplied.g),
        premultiplied.b
      );
      float normalizedEnergy = maximumPremultiplied / safeOpacity;
      float energyRatio = normalizedEnergy /
        max(normalizedCoverage, 0.000001);
      float gate = smoothstep(0.25, 0.75, energyRatio) *
        smoothstep(0.03125, 0.25, normalizedEnergy);

      // 聚合后只混合一次；峰值不增加，蓝青核心不会再坍缩成纯白。
      premultiplied = mix(
        premultiplied,
        vec3(maximumPremultiplied),
        0.35 * gate
      );
    }

    outColor = vec4(premultiplied, alpha);
    return;
  }

  float maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);
  // Bloom 会扩散到 Cross2 Coverage 之外。无场景背景可用于精确反解时，
  // Alpha 至少要覆盖发光 RGB，避免透明桌面合成出现非法的 RGB > Alpha。
  float alpha = u_hasScene
    ? max(clamp(scene.a, 0.0, 1.0), maximumSrgb)
    : maximumSrgb;

  if (maximumSrgb <= 0.00001 && alpha <= 0.00001)
  {
    outColor = vec4(0.0);
    return;
  }

  // WebGL Canvas 以预乘 Alpha 交给页面合成器。
  outColor = vec4(srgb, alpha);
}
`;
function clamp$3(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}
function getTexImageSourceDimensions$1(source) {
	if (!source) return null;
	let width;
	let height;
	try {
		width = source.naturalWidth ?? source.videoWidth ?? source.displayWidth ?? source.width;
		height = source.naturalHeight ?? source.videoHeight ?? source.displayHeight ?? source.height;
	} catch {
		return null;
	}
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	return {
		width,
		height
	};
}
function calculatePyramidSettings(displayWidth, displayHeight, resolutionScale, diffusion) {
	const safeScale = clamp$3(resolutionScale, .1, .75);
	const maxSize = Math.max(1, Math.floor(displayWidth * safeScale), Math.floor(displayHeight * safeScale));
	const logIterations = Math.log2(maxSize) + Math.min(Math.max(0, diffusion), 10) - 10;
	return {
		levelCount: clamp$3(Math.floor(logIterations), 1, MAX_PYRAMID_LEVELS),
		sampleScale: .5 + logIterations - Math.floor(logIterations)
	};
}
function compileShader$1(gl, type, source) {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("WebGL2 无法创建 Shader");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader) || "未知 Shader 编译错误";
		gl.deleteShader(shader);
		throw new Error(message);
	}
	return shader;
}
function createProgram$1(gl, vertexSource, fragmentSource) {
	let vertexShader = null;
	let fragmentShader = null;
	let program = null;
	try {
		vertexShader = compileShader$1(gl, gl.VERTEX_SHADER, vertexSource);
		fragmentShader = compileShader$1(gl, gl.FRAGMENT_SHADER, fragmentSource);
		program = gl.createProgram();
		if (!program) throw new Error("WebGL2 无法创建 Program");
		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "未知 Program 链接错误");
		return program;
	} catch (error) {
		gl.deleteProgram(program);
		throw error;
	} finally {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
	}
}
function deleteTarget(gl, target) {
	if (!target) return;
	gl.deleteFramebuffer(target.framebuffer);
	gl.deleteTexture(target.texture);
}
var WebGL2EffectRenderer = class {
	get hasSceneBackground() {
		return this.sceneBackgroundSource !== null;
	}
	constructor(canvas, options = {}) {
		this.canvas = canvas;
		this.sceneEnabled = true;
		this.gl = null;
		this.available = false;
		this.contextLost = false;
		this.displayWidth = 1;
		this.displayHeight = 1;
		this.sourceWidth = 0;
		this.sourceHeight = 0;
		this.width = 0;
		this.height = 0;
		this.dpr = 1;
		this.resolutionScale = 0;
		this.diffusion = 0;
		this.sampleScale = 1;
		this.maximumTextureSize = 0;
		this.maximumViewportWidth = 0;
		this.maximumViewportHeight = 0;
		this.vertexCount = 0;
		this.vertexData = new Float32Array(INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_VERTEX$1);
		this.sceneDiskVertexCount = 0;
		this.sceneDiskVertexData = new Float32Array(INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_DISK_VERTEX$1);
		this.ringVertexCount = 0;
		this.ringVertexData = new Float32Array(INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_RING_VERTEX$1);
		this.triangleVertexCount = 0;
		this.triangleVertexData = new Float32Array(INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_TRIANGLE_VERTEX);
		this.trailVertexCount = 0;
		this.trailVertexData = new Float32Array(INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_TRAIL_VERTEX);
		this.sourceTarget = null;
		this.bloomSourceTarget = null;
		this.sceneOverlayTarget = null;
		this.levels = [];
		this.sceneFrameReady = false;
		this.bloomSourceFrameReady = false;
		this.sceneOverlayFrameReady = false;
		this.sceneBackgroundFrameReady = false;
		this.sceneBackgroundSource = null;
		this.sceneBackgroundWidth = 0;
		this.sceneBackgroundHeight = 0;
		this.sceneBackgroundUploadRetryPending = false;
		this.sceneBackgroundTexture = null;
		this.sceneBackgroundTarget = null;
		this.failedResizeSignature = null;
		this.programs = null;
		this.emissionBuffer = null;
		this.emissionVao = null;
		this.sceneDiskBuffer = null;
		this.sceneDiskVao = null;
		this.ringBuffer = null;
		this.ringVao = null;
		this.ringTexture = null;
		this.triangleBuffer = null;
		this.triangleVao = null;
		this.triangleTexture = null;
		this.triangleOverlayTexture = null;
		this.trailTexture = null;
		this.circleTexture = null;
		this.fullscreenVao = null;
		this.stats = {
			vertexCount: 0,
			sceneVertexCount: 0,
			sceneDiskVertexCount: 0,
			sceneRingVertexCount: 0,
			sceneTriangleVertexCount: 0,
			sceneTrailVertexCount: 0,
			diskVertexCount: 0,
			ringVertexCount: 0,
			triangleVertexCount: 0,
			trailVertexCount: 0,
			levelCount: 0,
			bloomPixels: 0
		};
		this._onContextLost = this._handleContextLost.bind(this);
		this._onContextRestored = this._handleContextRestored.bind(this);
		if (options.initialize !== false) {
			this.canvas?.addEventListener?.("webglcontextlost", this._onContextLost);
			this.canvas?.addEventListener?.("webglcontextrestored", this._onContextRestored);
			this._initialize();
		}
	}
	_initialize() {
		try {
			const gl = this.canvas?.getContext?.("webgl2", {
				alpha: true,
				antialias: false,
				depth: false,
				stencil: false,
				premultipliedAlpha: true,
				preserveDrawingBuffer: false,
				powerPreference: "high-performance"
			});
			if (!gl || !gl.getExtension("EXT_color_buffer_float")) {
				this.available = false;
				return;
			}
			this.gl = gl;
			this.maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
			const maximumViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
			this.maximumViewportWidth = maximumViewport?.[0] ?? this.maximumTextureSize;
			this.maximumViewportHeight = maximumViewport?.[1] ?? this.maximumTextureSize;
			if (this.maximumTextureSize <= 0 || this.maximumViewportWidth <= 0 || this.maximumViewportHeight <= 0) throw new Error("WebGL2 无法查询纹理或视口尺寸上限");
			this.programs = {};
			this.programs.emission = createProgram$1(gl, EMISSION_VERTEX_SHADER, EMISSION_FRAGMENT_SHADER);
			this.programs.scene = this.sceneEnabled ? createProgram$1(gl, EMISSION_VERTEX_SHADER, SCENE_FRAGMENT_SHADER) : null;
			this.programs.sceneDisk = createProgram$1(gl, SCENE_DISK_VERTEX_SHADER, SCENE_DISK_FRAGMENT_SHADER);
			this.programs.dissolveRing = createProgram$1(gl, DISSOLVE_RING_VERTEX_SHADER, DISSOLVE_RING_FRAGMENT_SHADER);
			this.programs.triangle = createProgram$1(gl, TRIANGLE_VERTEX_SHADER, TRIANGLE_FRAGMENT_SHADER);
			this.programs.sceneBackground = createProgram$1(gl, FULLSCREEN_VERTEX_SHADER$1, SCENE_BACKGROUND_FRAGMENT_SHADER);
			this.programs.sceneOverlay = createProgram$1(gl, FULLSCREEN_VERTEX_SHADER$1, SCENE_OVERLAY_FRAGMENT_SHADER);
			this.programs.prefilter = createProgram$1(gl, FULLSCREEN_VERTEX_SHADER$1, PREFILTER_FRAGMENT_SHADER);
			this.programs.downsample = createProgram$1(gl, FULLSCREEN_VERTEX_SHADER$1, DOWNSAMPLE_FRAGMENT_SHADER);
			this.programs.upsample = createProgram$1(gl, FULLSCREEN_VERTEX_SHADER$1, UPSAMPLE_FRAGMENT_SHADER);
			this.programs.final = createProgram$1(gl, FULLSCREEN_VERTEX_SHADER$1, FINAL_FRAGMENT_SHADER$1);
			this.emissionBuffer = gl.createBuffer();
			this.emissionVao = gl.createVertexArray();
			this.sceneDiskBuffer = gl.createBuffer();
			this.sceneDiskVao = gl.createVertexArray();
			this.ringBuffer = gl.createBuffer();
			this.ringVao = gl.createVertexArray();
			this.ringTexture = gl.createTexture();
			this.triangleBuffer = gl.createBuffer();
			this.triangleVao = gl.createVertexArray();
			this.triangleTexture = gl.createTexture();
			this.triangleOverlayTexture = gl.createTexture();
			this.trailTexture = gl.createTexture();
			this.circleTexture = gl.createTexture();
			this.fullscreenVao = gl.createVertexArray();
			if (!this.emissionBuffer || !this.emissionVao || !this.fullscreenVao || !this.sceneDiskBuffer || !this.sceneDiskVao || !this.ringBuffer || !this.ringVao || !this.ringTexture || !this.triangleBuffer || !this.triangleVao || !this.triangleTexture || !this.triangleOverlayTexture || !this.trailTexture || !this.circleTexture) throw new Error("WebGL2 无法创建几何缓冲");
			gl.bindVertexArray(this.emissionVao);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.emissionBuffer);
			const stride = COMPONENTS_PER_VERTEX$1 * Float32Array.BYTES_PER_ELEMENT;
			const positionLocation = 0;
			const colorLocation = 1;
			const coverageLocation = 2;
			gl.enableVertexAttribArray(positionLocation);
			gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
			gl.enableVertexAttribArray(colorLocation);
			gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
			gl.enableVertexAttribArray(coverageLocation);
			gl.vertexAttribPointer(coverageLocation, 1, gl.FLOAT, false, stride, 5 * Float32Array.BYTES_PER_ELEMENT);
			gl.bindVertexArray(null);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			gl.bindVertexArray(this.sceneDiskVao);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.sceneDiskBuffer);
			const diskStride = COMPONENTS_PER_DISK_VERTEX$1 * Float32Array.BYTES_PER_ELEMENT;
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, diskStride, 0);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribPointer(1, 2, gl.FLOAT, false, diskStride, 2 * Float32Array.BYTES_PER_ELEMENT);
			gl.enableVertexAttribArray(2);
			gl.vertexAttribPointer(2, 3, gl.FLOAT, false, diskStride, 4 * Float32Array.BYTES_PER_ELEMENT);
			gl.enableVertexAttribArray(3);
			gl.vertexAttribPointer(3, 1, gl.FLOAT, false, diskStride, 7 * Float32Array.BYTES_PER_ELEMENT);
			gl.bindVertexArray(this.ringVao);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.ringBuffer);
			const ringStride = COMPONENTS_PER_RING_VERTEX$1 * Float32Array.BYTES_PER_ELEMENT;
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, ringStride, 0);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribPointer(1, 2, gl.FLOAT, false, ringStride, 2 * Float32Array.BYTES_PER_ELEMENT);
			gl.enableVertexAttribArray(2);
			gl.vertexAttribPointer(2, 3, gl.FLOAT, false, ringStride, 4 * Float32Array.BYTES_PER_ELEMENT);
			gl.enableVertexAttribArray(3);
			gl.vertexAttribPointer(3, 1, gl.FLOAT, false, ringStride, 7 * Float32Array.BYTES_PER_ELEMENT);
			gl.enableVertexAttribArray(4);
			gl.vertexAttribPointer(4, 1, gl.FLOAT, false, ringStride, 8 * Float32Array.BYTES_PER_ELEMENT);
			gl.bindVertexArray(null);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			gl.bindVertexArray(this.triangleVao);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.triangleBuffer);
			const triangleStride = COMPONENTS_PER_TRIANGLE_VERTEX * Float32Array.BYTES_PER_ELEMENT;
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, triangleStride, 0);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribPointer(1, 2, gl.FLOAT, false, triangleStride, 2 * Float32Array.BYTES_PER_ELEMENT);
			gl.enableVertexAttribArray(2);
			gl.vertexAttribPointer(2, 3, gl.FLOAT, false, triangleStride, 4 * Float32Array.BYTES_PER_ELEMENT);
			gl.enableVertexAttribArray(3);
			gl.vertexAttribPointer(3, 1, gl.FLOAT, false, triangleStride, 7 * Float32Array.BYTES_PER_ELEMENT);
			gl.enableVertexAttribArray(4);
			gl.vertexAttribPointer(4, 1, gl.FLOAT, false, triangleStride, 8 * Float32Array.BYTES_PER_ELEMENT);
			gl.bindVertexArray(null);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			gl.bindTexture(gl.TEXTURE_2D, this.ringTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 128, 0, gl.RED, gl.UNSIGNED_BYTE, RING3_ALPHA);
			gl.bindTexture(gl.TEXTURE_2D, this.triangleTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, TRIANGLE_TEXTURE_RGBA);
			gl.bindTexture(gl.TEXTURE_2D, this.triangleOverlayTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, TRIANGLE_TEXTURE_OVERLAY_RGBA);
			gl.bindTexture(gl.TEXTURE_2D, this.trailTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, TRAIL_TEXTURE_RGBA);
			gl.bindTexture(gl.TEXTURE_2D, this.circleTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, CIRCLE_TEXTURE_RGBA);
			gl.bindTexture(gl.TEXTURE_2D, null);
			this.contextLost = false;
			this.available = true;
			if (this.sceneBackgroundSource) this.sceneBackgroundUploadRetryPending = !this._replaceSceneBackgroundTexture(this.sceneBackgroundSource);
			if (this.width > 0 && this.height > 0) this._allocateTargets();
		} catch (error) {
			console.warn("[BAClickFX] WebGL2 Scene 初始化失败:", error);
			this.available = false;
			this._deleteResources();
		}
	}
	_handleContextLost(event) {
		event?.preventDefault?.();
		this.contextLost = true;
		this.available = false;
		this.sceneFrameReady = false;
		this.bloomSourceFrameReady = false;
		this.sceneOverlayFrameReady = false;
		this.sceneBackgroundFrameReady = false;
		this.sceneBackgroundUploadRetryPending = this.sceneBackgroundSource !== null;
	}
	_handleContextRestored() {
		this._forgetResourceReferences();
		this._initialize();
		this.failedResizeSignature = null;
	}
	_forgetResourceReferences() {
		this.sourceTarget = null;
		this.bloomSourceTarget = null;
		this.sceneOverlayTarget = null;
		this.levels = [];
		this.sceneFrameReady = false;
		this.bloomSourceFrameReady = false;
		this.sceneOverlayFrameReady = false;
		this.sceneBackgroundFrameReady = false;
		this.failedResizeSignature = null;
		this.programs = null;
		this.emissionBuffer = null;
		this.emissionVao = null;
		this.sceneDiskBuffer = null;
		this.sceneDiskVao = null;
		this.ringBuffer = null;
		this.ringVao = null;
		this.ringTexture = null;
		this.triangleBuffer = null;
		this.triangleVao = null;
		this.triangleTexture = null;
		this.triangleOverlayTexture = null;
		this.trailTexture = null;
		this.circleTexture = null;
		this.sceneBackgroundTexture = null;
		this.sceneBackgroundTarget = null;
		this.fullscreenVao = null;
		this.vertexCount = 0;
		this.sceneDiskVertexCount = 0;
		this.ringVertexCount = 0;
		this.triangleVertexCount = 0;
		this.trailVertexCount = 0;
		this.stats.vertexCount = 0;
		this.stats.sceneVertexCount = 0;
		this.stats.sceneDiskVertexCount = 0;
		this.stats.sceneRingVertexCount = 0;
		this.stats.sceneTriangleVertexCount = 0;
		this.stats.sceneTrailVertexCount = 0;
		this.stats.diskVertexCount = 0;
		this.stats.ringVertexCount = 0;
		this.stats.triangleVertexCount = 0;
		this.stats.trailVertexCount = 0;
		this.stats.levelCount = 0;
		this.stats.bloomPixels = 0;
	}
	_createTarget(width, height) {
		const gl = this.gl;
		const texture = gl.createTexture();
		const framebuffer = gl.createFramebuffer();
		if (!texture || !framebuffer) {
			gl.deleteTexture(texture);
			gl.deleteFramebuffer(framebuffer);
			throw new Error("WebGL2 无法创建 Bloom RenderTarget");
		}
		try {
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
			if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("WebGL2 浮点 Bloom Framebuffer 不完整");
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.bindTexture(gl.TEXTURE_2D, null);
			return {
				texture,
				framebuffer,
				width,
				height
			};
		} catch (error) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.bindTexture(gl.TEXTURE_2D, null);
			gl.deleteFramebuffer(framebuffer);
			gl.deleteTexture(texture);
			throw error;
		}
	}
	_deleteTargets() {
		const gl = this.gl;
		if (gl && !this.contextLost) {
			deleteTarget(gl, this.sourceTarget);
			deleteTarget(gl, this.bloomSourceTarget);
			deleteTarget(gl, this.sceneOverlayTarget);
			deleteTarget(gl, this.sceneBackgroundTarget);
			for (const level of this.levels) {
				deleteTarget(gl, level.down);
				deleteTarget(gl, level.scratch);
				deleteTarget(gl, level.up);
			}
		}
		this.sourceTarget = null;
		this.bloomSourceTarget = null;
		this.sceneOverlayTarget = null;
		this.sceneBackgroundTarget = null;
		this.sceneFrameReady = false;
		this.bloomSourceFrameReady = false;
		this.sceneOverlayFrameReady = false;
		this.sceneBackgroundFrameReady = false;
		this.levels = [];
		this.stats.levelCount = 0;
		this.stats.bloomPixels = 0;
	}
	releaseFrameResources() {
		this._deleteTargets();
		this.beginFrame();
		this.displayWidth = 1;
		this.displayHeight = 1;
		this.sourceWidth = 0;
		this.sourceHeight = 0;
		this.width = 0;
		this.height = 0;
		this.dpr = 1;
		this.resolutionScale = 0;
		this.diffusion = 0;
		this.sampleScale = 1;
		this.failedResizeSignature = null;
		if (this.canvas && (this.canvas.width !== 1 || this.canvas.height !== 1)) {
			this.canvas.width = 1;
			this.canvas.height = 1;
		}
	}
	_deleteResources() {
		if (!this.gl) return;
		const gl = this.gl;
		this._deleteTargets();
		if (this.programs) {
			for (const program of Object.values(this.programs)) if (program) gl.deleteProgram(program);
		}
		gl.deleteBuffer(this.emissionBuffer);
		gl.deleteVertexArray(this.emissionVao);
		gl.deleteBuffer(this.sceneDiskBuffer);
		gl.deleteVertexArray(this.sceneDiskVao);
		gl.deleteBuffer(this.ringBuffer);
		gl.deleteVertexArray(this.ringVao);
		gl.deleteTexture(this.ringTexture);
		gl.deleteBuffer(this.triangleBuffer);
		gl.deleteVertexArray(this.triangleVao);
		gl.deleteTexture(this.triangleTexture);
		gl.deleteTexture(this.triangleOverlayTexture);
		gl.deleteTexture(this.trailTexture);
		gl.deleteTexture(this.circleTexture);
		gl.deleteTexture(this.sceneBackgroundTexture);
		gl.deleteVertexArray(this.fullscreenVao);
		this.programs = null;
		this.emissionBuffer = null;
		this.emissionVao = null;
		this.sceneDiskBuffer = null;
		this.sceneDiskVao = null;
		this.ringBuffer = null;
		this.ringVao = null;
		this.ringTexture = null;
		this.triangleBuffer = null;
		this.triangleVao = null;
		this.triangleTexture = null;
		this.triangleOverlayTexture = null;
		this.trailTexture = null;
		this.circleTexture = null;
		this.sceneBackgroundTexture = null;
		this.sceneBackgroundTarget = null;
		this.sceneBackgroundFrameReady = false;
		this.fullscreenVao = null;
		this.stats.vertexCount = 0;
		this.stats.sceneVertexCount = 0;
		this.stats.sceneDiskVertexCount = 0;
		this.stats.sceneRingVertexCount = 0;
		this.stats.sceneTriangleVertexCount = 0;
		this.stats.sceneTrailVertexCount = 0;
		this.stats.diskVertexCount = 0;
		this.stats.ringVertexCount = 0;
		this.stats.triangleVertexCount = 0;
		this.stats.trailVertexCount = 0;
		this.stats.levelCount = 0;
		this.stats.bloomPixels = 0;
	}
	_discardPendingErrors() {
		const gl = this.gl;
		if (!gl || typeof gl.getError !== "function") return;
		for (let count = 0; count < 8; count++) if (gl.getError() === gl.NO_ERROR) return;
	}
	_createSceneBackgroundTexture(source) {
		const gl = this.gl;
		const texture = gl?.createTexture();
		if (!gl || !texture) return null;
		const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
		const previousFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
		const previousPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
		try {
			this._discardPendingErrors();
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
			const error = gl.getError();
			if (error !== gl.NO_ERROR) throw new Error(`WebGL2 背景纹理上传错误码 ${error}`);
			return texture;
		} catch (error) {
			console.warn("[BAClickFX] Scene 背景无法上传，保留透明回退:", error);
			gl.deleteTexture(texture);
			return null;
		} finally {
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previousFlipY);
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, previousPremultiply);
			gl.bindTexture(gl.TEXTURE_2D, previousTexture);
		}
	}
	_replaceSceneBackgroundTexture(source) {
		const dimensions = getTexImageSourceDimensions$1(source);
		if (!dimensions || !this.gl || this.contextLost) return false;
		const texture = this._createSceneBackgroundTexture(source);
		if (!texture) return false;
		const requiresTarget = !!this.sourceTarget && this.sourceWidth > 0 && this.sourceHeight > 0;
		const target = requiresTarget ? this._createSceneBackgroundTarget(texture, dimensions.width, dimensions.height) : null;
		if (requiresTarget && !target) {
			this.gl.deleteTexture(texture);
			return false;
		}
		const previousTexture = this.sceneBackgroundTexture;
		const previousTarget = this.sceneBackgroundTarget;
		this.sceneBackgroundTexture = texture;
		this.sceneBackgroundTarget = target;
		this.sceneBackgroundSource = source;
		this.sceneBackgroundWidth = dimensions.width;
		this.sceneBackgroundHeight = dimensions.height;
		this.sceneBackgroundFrameReady = false;
		this.sceneBackgroundUploadRetryPending = false;
		this.failedResizeSignature = null;
		this.gl.deleteTexture(previousTexture);
		deleteTarget(this.gl, previousTarget);
		return true;
	}
	setCompositingReference(source, options = {}) {
		if (source === null) {
			this.gl?.deleteTexture(this.sceneBackgroundTexture);
			deleteTarget(this.gl, this.sceneBackgroundTarget);
			this.sceneBackgroundSource = null;
			this.sceneBackgroundWidth = 0;
			this.sceneBackgroundHeight = 0;
			this.sceneBackgroundTexture = null;
			this.sceneBackgroundTarget = null;
			this.sceneBackgroundFrameReady = false;
			this.sceneBackgroundUploadRetryPending = false;
			this.failedResizeSignature = null;
			return true;
		}
		if (options.fit !== void 0 && options.fit !== "cover") return false;
		if (this.contextLost || !this.gl) {
			const dimensions = getTexImageSourceDimensions$1(source);
			if (!dimensions) return false;
			this.sceneBackgroundSource = source;
			this.sceneBackgroundWidth = dimensions.width;
			this.sceneBackgroundHeight = dimensions.height;
			this.sceneBackgroundFrameReady = false;
			this.sceneBackgroundUploadRetryPending = true;
			return true;
		}
		return this._replaceSceneBackgroundTexture(source);
	}
	_getSceneBackgroundUvScale(backgroundWidth = this.sceneBackgroundWidth, backgroundHeight = this.sceneBackgroundHeight) {
		const sourceAspect = backgroundWidth / backgroundHeight;
		const displayAspect = this.displayWidth / this.displayHeight;
		if (sourceAspect > displayAspect) return [displayAspect / sourceAspect, 1];
		return [1, sourceAspect / displayAspect];
	}
	_createSceneBackgroundTarget(texture, backgroundWidth, backgroundHeight) {
		if (!texture || !this.programs?.sceneBackground || !this.sourceTarget || this.sourceWidth <= 0 || this.sourceHeight <= 0) return null;
		const gl = this.gl;
		const program = this.programs.sceneBackground;
		const uvScale = this._getSceneBackgroundUvScale(backgroundWidth, backgroundHeight);
		let target = null;
		try {
			target = this._createTarget(this.sourceWidth, this.sourceHeight);
			gl.disable(gl.BLEND);
			gl.useProgram(program);
			this._bindTexture(program, "u_background", texture, 0);
			gl.uniform2f(gl.getUniformLocation(program, "u_uvScale"), uvScale[0], uvScale[1]);
			this._drawFullscreen(program, target, this.sourceWidth, this.sourceHeight);
			const error = gl.getError();
			if (error !== gl.NO_ERROR) throw new Error(`WebGL2 Scene 背景解析错误码 ${error}`);
			return target;
		} catch (error) {
			console.warn("[BAClickFX] Scene 背景缓冲创建失败，保留现有背景:", error);
			deleteTarget(gl, target);
			this._discardPendingErrors();
			return null;
		}
	}
	_rebuildSceneBackgroundTarget() {
		const target = this._createSceneBackgroundTarget(this.sceneBackgroundTexture, this.sceneBackgroundWidth, this.sceneBackgroundHeight);
		if (!target) {
			deleteTarget(this.gl, this.sceneBackgroundTarget);
			this.sceneBackgroundTarget = null;
			return false;
		}
		deleteTarget(this.gl, this.sceneBackgroundTarget);
		this.sceneBackgroundTarget = target;
		return true;
	}
	_copySceneBackgroundToTarget(target) {
		if (!this.sceneBackgroundTarget || !target) return false;
		const gl = this.gl;
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneBackgroundTarget.framebuffer);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
		gl.blitFramebuffer(0, 0, this.sourceWidth, this.sourceHeight, 0, 0, this.sourceWidth, this.sourceHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
		gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
		return true;
	}
	_ensureBloomSourceTarget() {
		if (this.bloomSourceTarget?.width === this.sourceWidth && this.bloomSourceTarget?.height === this.sourceHeight) return true;
		deleteTarget(this.gl, this.bloomSourceTarget);
		this.bloomSourceTarget = this._createTarget(this.sourceWidth, this.sourceHeight);
		return this.bloomSourceTarget !== null;
	}
	_allocateTargets() {
		if (!this.available || !this.gl || this.width <= 0 || this.height <= 0) return false;
		try {
			this._deleteTargets();
			this.sourceTarget = this._createTarget(this.sourceWidth, this.sourceHeight);
			this.sceneOverlayTarget = this._createTarget(this.sourceWidth, this.sourceHeight);
			const pyramid = calculatePyramidSettings(this.sourceWidth, this.sourceHeight, this.resolutionScale, this.diffusion);
			const levelCount = pyramid.levelCount;
			this.sampleScale = pyramid.sampleScale;
			let width = this.width;
			let height = this.height;
			for (let index = 0; index < levelCount; index++) {
				const level = {
					width,
					height,
					down: null,
					scratch: null,
					up: null
				};
				this.levels.push(level);
				level.down = this._createTarget(width, height);
				level.scratch = null;
				level.up = index === levelCount - 1 ? null : this._createTarget(width, height);
				if (width === 1 && height === 1) break;
				width = Math.max(1, width >> 1);
				height = Math.max(1, height >> 1);
			}
			if (this.sceneBackgroundTexture) {
				if (!this._rebuildSceneBackgroundTarget()) throw new Error("WebGL2 Scene 背景目标重建失败");
			}
			this.stats.levelCount = this.levels.length;
			this.stats.bloomPixels = this.levels.reduce((total, level) => total + level.width * level.height, 0);
			this.failedResizeSignature = null;
			return true;
		} catch (error) {
			console.warn("[BAClickFX] WebGL2 Scene 缓冲创建失败:", error);
			this.failedResizeSignature = this._createResizeSignature(this.sourceWidth, this.sourceHeight, this.width, this.height, this.diffusion);
			this._deleteTargets();
			this._discardPendingErrors();
			return false;
		}
	}
	_createResizeSignature(sourceWidth, sourceHeight, width, height, diffusion) {
		return `${sourceWidth}:${sourceHeight}:${width}:${height}:${diffusion}`;
	}
	resize(displayWidth, displayHeight, dpr, resolutionScale, diffusion) {
		const safeDisplayWidth = Math.max(1, displayWidth);
		const safeDisplayHeight = Math.max(1, displayHeight);
		const safeDpr = clamp$3(dpr, 1, 4);
		const safeScale = clamp$3(resolutionScale, .1, .75);
		const sourceWidth = Math.max(1, Math.round(safeDisplayWidth * safeDpr));
		const sourceHeight = Math.max(1, Math.round(safeDisplayHeight * safeDpr));
		const width = Math.max(1, Math.floor(sourceWidth * safeScale));
		const height = Math.max(1, Math.floor(sourceHeight * safeScale));
		const safeDiffusion = clamp$3(diffusion, 0, 10);
		const resizeSignature = this._createResizeSignature(sourceWidth, sourceHeight, width, height, safeDiffusion);
		if (resizeSignature === this.failedResizeSignature) return false;
		if (sourceWidth > this.maximumTextureSize || sourceHeight > this.maximumTextureSize || sourceWidth > this.maximumViewportWidth || sourceHeight > this.maximumViewportHeight) {
			this.failedResizeSignature = resizeSignature;
			console.warn("[BAClickFX] WebGL2 Scene 尺寸超过设备上限");
			this._deleteTargets();
			return false;
		}
		if (this.sceneBackgroundUploadRetryPending) {
			this.sceneBackgroundUploadRetryPending = false;
			if (!this._replaceSceneBackgroundTexture(this.sceneBackgroundSource)) return false;
		}
		const unchanged = sourceWidth === this.sourceWidth && sourceHeight === this.sourceHeight && width === this.width && height === this.height && safeDiffusion === this.diffusion && this.sourceTarget !== null && this.sceneOverlayTarget !== null && this.levels.length > 0;
		this.displayWidth = safeDisplayWidth;
		this.displayHeight = safeDisplayHeight;
		this.dpr = safeDpr;
		this.resolutionScale = safeScale;
		this.diffusion = safeDiffusion;
		this.sourceWidth = sourceWidth;
		this.sourceHeight = sourceHeight;
		if (unchanged) {
			this.failedResizeSignature = null;
			return this.available;
		}
		this.width = width;
		this.height = height;
		this.canvas.width = sourceWidth;
		this.canvas.height = sourceHeight;
		return this._allocateTargets();
	}
	beginFrame(options = {}) {
		this.vertexCount = 0;
		this.sceneDiskVertexCount = 0;
		this.ringVertexCount = 0;
		this.triangleVertexCount = 0;
		this.trailVertexCount = 0;
		this.stats.vertexCount = 0;
		this.stats.diskVertexCount = 0;
		this.stats.ringVertexCount = 0;
		this.stats.triangleVertexCount = 0;
		this.stats.trailVertexCount = 0;
		if (options.preserveSceneStats !== true) {
			this.sceneFrameReady = false;
			this.bloomSourceFrameReady = false;
			this.sceneOverlayFrameReady = false;
			this.sceneBackgroundFrameReady = false;
			this.stats.sceneVertexCount = 0;
			this.stats.sceneDiskVertexCount = 0;
			this.stats.sceneRingVertexCount = 0;
			this.stats.sceneTriangleVertexCount = 0;
			this.stats.sceneTrailVertexCount = 0;
		}
	}
	_hasGeometry() {
		return this.vertexCount > 0 || this.sceneDiskVertexCount > 0 || this.ringVertexCount > 0 || this.triangleVertexCount > 0 || this.trailVertexCount > 0;
	}
	_drawTexturedAdditiveBatch(vertexCount, vertexData, buffer, vertexArray, texture, transparentOverlay, alphaModulatesEmission = true, antialiasGeometryCoverage = false, roundTriangle = false) {
		if (vertexCount <= 0) return;
		const gl = this.gl;
		const program = this.programs.triangle;
		if (transparentOverlay) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		else gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
		gl.useProgram(program);
		gl.uniform1i(gl.getUniformLocation(program, "u_transparentOverlay"), transparentOverlay ? 1 : 0);
		gl.uniform1i(gl.getUniformLocation(program, "u_alphaModulatesEmission"), alphaModulatesEmission ? 1 : 0);
		gl.uniform1i(gl.getUniformLocation(program, "u_antialiasGeometryCoverage"), antialiasGeometryCoverage ? 1 : 0);
		gl.uniform1i(gl.getUniformLocation(program, "u_roundTriangle"), roundTriangle ? 1 : 0);
		gl.uniform2f(gl.getUniformLocation(program, "u_displaySize"), this.displayWidth, this.displayHeight);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0);
		gl.bindVertexArray(vertexArray);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
	}
	_drawGeometryBatches(additiveProgram, transparentOverlay = false, clickEmissionScales = null) {
		const gl = this.gl;
		const diskEmissionScale = Math.max(0, clickEmissionScales?.disk ?? 1);
		const ringEmissionScale = Math.max(0, clickEmissionScales?.ring ?? 1);
		gl.enable(gl.BLEND);
		gl.blendEquation(gl.FUNC_ADD);
		if (this.sceneDiskVertexCount > 0) {
			const diskProgram = this.programs.sceneDisk;
			gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			gl.useProgram(diskProgram);
			gl.uniform2f(gl.getUniformLocation(diskProgram, "u_displaySize"), this.displayWidth, this.displayHeight);
			gl.uniform1f(gl.getUniformLocation(diskProgram, "u_emissionScale"), diskEmissionScale);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.circleTexture);
			gl.uniform1i(gl.getUniformLocation(diskProgram, "u_texture"), 0);
			gl.bindVertexArray(this.sceneDiskVao);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.sceneDiskBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, this.sceneDiskVertexData.subarray(0, this.sceneDiskVertexCount * COMPONENTS_PER_DISK_VERTEX$1), gl.DYNAMIC_DRAW);
			gl.drawArrays(gl.TRIANGLES, 0, this.sceneDiskVertexCount);
		}
		this._drawTexturedAdditiveBatch(this.trailVertexCount, this.trailVertexData.subarray(0, this.trailVertexCount * COMPONENTS_PER_TRAIL_VERTEX), this.triangleBuffer, this.triangleVao, this.trailTexture, transparentOverlay, false, true);
		if (this.vertexCount > 0) {
			if (transparentOverlay) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			else gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
			gl.useProgram(additiveProgram);
			const compositingLocation = gl.getUniformLocation(additiveProgram, "u_transparentOverlay");
			if (compositingLocation !== null) gl.uniform1i(compositingLocation, transparentOverlay ? 1 : 0);
			gl.uniform2f(gl.getUniformLocation(additiveProgram, "u_displaySize"), this.displayWidth, this.displayHeight);
			gl.bindVertexArray(this.emissionVao);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.emissionBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.subarray(0, this.vertexCount * COMPONENTS_PER_VERTEX$1), gl.DYNAMIC_DRAW);
			gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
		}
		if (this.triangleVertexCount > 0) this._drawTexturedAdditiveBatch(this.triangleVertexCount, this.triangleVertexData.subarray(0, this.triangleVertexCount * COMPONENTS_PER_TRIANGLE_VERTEX), this.triangleBuffer, this.triangleVao, transparentOverlay ? this.triangleOverlayTexture : this.triangleTexture, transparentOverlay, true, false, true);
		if (this.ringVertexCount > 0) {
			const ringProgram = this.programs.dissolveRing;
			if (transparentOverlay) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
			else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
			gl.useProgram(ringProgram);
			gl.uniform1i(gl.getUniformLocation(ringProgram, "u_transparentOverlay"), transparentOverlay ? 1 : 0);
			gl.uniform1f(gl.getUniformLocation(ringProgram, "u_emissionScale"), ringEmissionScale);
			gl.uniform2f(gl.getUniformLocation(ringProgram, "u_displaySize"), this.displayWidth, this.displayHeight);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.ringTexture);
			gl.uniform1i(gl.getUniformLocation(ringProgram, "u_texture"), 0);
			gl.bindVertexArray(this.ringVao);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.ringBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, this.ringVertexData.subarray(0, this.ringVertexCount * COMPONENTS_PER_RING_VERTEX$1), gl.DYNAMIC_DRAW);
			gl.drawArrays(gl.TRIANGLES, 0, this.ringVertexCount);
		}
		gl.disable(gl.BLEND);
	}
	_renderScaledBloomSource(settings) {
		const disk = Math.max(0, settings.diskEmissionScale ?? 1);
		const ring = Math.max(0, settings.ringEmissionScale ?? 1);
		this.bloomSourceFrameReady = false;
		if (disk === 1 && ring === 1) {
			deleteTarget(this.gl, this.bloomSourceTarget);
			this.bloomSourceTarget = null;
			return true;
		}
		if (!this._ensureBloomSourceTarget()) return false;
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomSourceTarget.framebuffer);
		gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		this._copySceneBackgroundToTarget(this.bloomSourceTarget);
		this._drawGeometryBatches(this.programs.scene, settings.outputCompositing === "browser-overlay", {
			disk,
			ring
		});
		this.bloomSourceFrameReady = true;
		return true;
	}
	renderScene(settings = {}) {
		if (!this.sceneEnabled || !this.available || this.contextLost || !this.programs?.scene || !this.sourceTarget) return false;
		const gl = this.gl;
		const needsCoverageOverlay = settings.outputCompositing === "browser-overlay" && !isIndependentHostCompositing(settings.hostCompositing);
		try {
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.sourceTarget.framebuffer);
			gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			this.sceneFrameReady = false;
			this.bloomSourceFrameReady = false;
			this.sceneOverlayFrameReady = false;
			this.sceneBackgroundFrameReady = this._copySceneBackgroundToTarget(this.sourceTarget);
			this.stats.sceneVertexCount = this.vertexCount + this.triangleVertexCount + this.trailVertexCount;
			this.stats.sceneDiskVertexCount = this.sceneDiskVertexCount;
			this.stats.sceneRingVertexCount = this.ringVertexCount;
			this.stats.sceneTriangleVertexCount = this.triangleVertexCount;
			this.stats.sceneTrailVertexCount = this.trailVertexCount;
			if (!this._hasGeometry()) {
				if (needsCoverageOverlay) this.sceneOverlayFrameReady = this._renderSceneOverlay();
				this.sceneFrameReady = true;
				return true;
			}
			this._drawGeometryBatches(this.programs.scene, settings.outputCompositing === "browser-overlay");
			if (!this._renderScaledBloomSource(settings)) throw new Error("WebGL2 独立点击 Bloom 源生成失败");
			if (needsCoverageOverlay) {
				this.sceneOverlayFrameReady = this._renderSceneOverlay();
				if (!this.sceneOverlayFrameReady) throw new Error("WebGL2 Scene 传输上界生成失败");
			}
			const error = gl.getError();
			if (error !== gl.NO_ERROR) throw new Error(`WebGL2 错误码 ${error}`);
			this.sceneFrameReady = true;
			return true;
		} catch (error) {
			console.warn("[BAClickFX] WebGL2 清晰特效渲染失败:", error);
			this.clear();
			this._deleteTargets();
			this.available = false;
			return false;
		}
	}
	_ensureVertexCapacity(additionalVertices) {
		const requiredComponents = (this.vertexCount + additionalVertices) * COMPONENTS_PER_VERTEX$1;
		if (requiredComponents <= this.vertexData.length) return;
		let nextLength = this.vertexData.length;
		while (nextLength < requiredComponents) nextLength = Math.ceil(nextLength * 1.5);
		const next = new Float32Array(nextLength);
		next.set(this.vertexData.subarray(0, this.vertexCount * COMPONENTS_PER_VERTEX$1));
		this.vertexData = next;
	}
	_appendVertex(x, y, red, green, blue, coverage) {
		const offset = this.vertexCount * COMPONENTS_PER_VERTEX$1;
		this.vertexData[offset] = x;
		this.vertexData[offset + 1] = y;
		this.vertexData[offset + 2] = Math.max(0, red);
		this.vertexData[offset + 3] = Math.max(0, green);
		this.vertexData[offset + 4] = Math.max(0, blue);
		this.vertexData[offset + 5] = clamp$3(coverage, 0, 1);
		this.vertexCount++;
	}
	_ensureSceneDiskVertexCapacity(additionalVertices) {
		const requiredComponents = (this.sceneDiskVertexCount + additionalVertices) * COMPONENTS_PER_DISK_VERTEX$1;
		if (requiredComponents <= this.sceneDiskVertexData.length) return;
		let nextLength = this.sceneDiskVertexData.length;
		while (nextLength < requiredComponents) nextLength = Math.ceil(nextLength * 1.5);
		const next = new Float32Array(nextLength);
		next.set(this.sceneDiskVertexData.subarray(0, this.sceneDiskVertexCount * COMPONENTS_PER_DISK_VERTEX$1));
		this.sceneDiskVertexData = next;
	}
	_appendSceneDiskVertex(x, y, u, v, red, green, blue, particleAlpha) {
		const offset = this.sceneDiskVertexCount * COMPONENTS_PER_DISK_VERTEX$1;
		this.sceneDiskVertexData[offset] = x;
		this.sceneDiskVertexData[offset + 1] = y;
		this.sceneDiskVertexData[offset + 2] = u;
		this.sceneDiskVertexData[offset + 3] = v;
		this.sceneDiskVertexData[offset + 4] = Math.max(0, red);
		this.sceneDiskVertexData[offset + 5] = Math.max(0, green);
		this.sceneDiskVertexData[offset + 6] = Math.max(0, blue);
		this.sceneDiskVertexData[offset + 7] = clamp$3(particleAlpha, 0, 1);
		this.sceneDiskVertexCount++;
	}
	_ensureRingVertexCapacity(additionalVertices) {
		const requiredComponents = (this.ringVertexCount + additionalVertices) * COMPONENTS_PER_RING_VERTEX$1;
		if (requiredComponents <= this.ringVertexData.length) return;
		let nextLength = this.ringVertexData.length;
		while (nextLength < requiredComponents) nextLength = Math.ceil(nextLength * 1.5);
		const next = new Float32Array(nextLength);
		next.set(this.ringVertexData.subarray(0, this.ringVertexCount * COMPONENTS_PER_RING_VERTEX$1));
		this.ringVertexData = next;
	}
	_appendRingVertex(x, y, u, v, red, green, blue, dissolveThreshold, coverageOpacity) {
		const offset = this.ringVertexCount * COMPONENTS_PER_RING_VERTEX$1;
		this.ringVertexData[offset] = x;
		this.ringVertexData[offset + 1] = y;
		this.ringVertexData[offset + 2] = u;
		this.ringVertexData[offset + 3] = v;
		this.ringVertexData[offset + 4] = Math.max(0, red);
		this.ringVertexData[offset + 5] = Math.max(0, green);
		this.ringVertexData[offset + 6] = Math.max(0, blue);
		this.ringVertexData[offset + 7] = clamp$3(dissolveThreshold, 0, 1);
		this.ringVertexData[offset + 8] = clamp$3(coverageOpacity, 0, 1);
		this.ringVertexCount++;
	}
	_ensureTriangleVertexCapacity(additionalVertices) {
		const requiredComponents = (this.triangleVertexCount + additionalVertices) * COMPONENTS_PER_TRIANGLE_VERTEX;
		if (requiredComponents <= this.triangleVertexData.length) return;
		let nextLength = this.triangleVertexData.length;
		while (nextLength < requiredComponents) nextLength = Math.ceil(nextLength * 1.5);
		const next = new Float32Array(nextLength);
		next.set(this.triangleVertexData.subarray(0, this.triangleVertexCount * COMPONENTS_PER_TRIANGLE_VERTEX));
		this.triangleVertexData = next;
	}
	_appendTriangleVertex(x, y, u, v, red, green, blue, particleAlpha, roundness = 0) {
		const offset = this.triangleVertexCount * COMPONENTS_PER_TRIANGLE_VERTEX;
		this.triangleVertexData[offset] = x;
		this.triangleVertexData[offset + 1] = y;
		this.triangleVertexData[offset + 2] = u;
		this.triangleVertexData[offset + 3] = v;
		this.triangleVertexData[offset + 4] = Math.max(0, red);
		this.triangleVertexData[offset + 5] = Math.max(0, green);
		this.triangleVertexData[offset + 6] = Math.max(0, blue);
		this.triangleVertexData[offset + 7] = clamp$3(particleAlpha, 0, 1);
		this.triangleVertexData[offset + 8] = clamp$3(roundness, 0, 1);
		this.triangleVertexCount++;
	}
	_ensureTrailVertexCapacity(additionalVertices) {
		const requiredComponents = (this.trailVertexCount + additionalVertices) * COMPONENTS_PER_TRAIL_VERTEX;
		if (requiredComponents <= this.trailVertexData.length) return;
		let nextLength = this.trailVertexData.length;
		while (nextLength < requiredComponents) nextLength = Math.ceil(nextLength * 1.5);
		const next = new Float32Array(nextLength);
		next.set(this.trailVertexData.subarray(0, this.trailVertexCount * COMPONENTS_PER_TRAIL_VERTEX));
		this.trailVertexData = next;
	}
	_appendTrailVertex(point, uv, color, particleAlpha, coverageFactor) {
		const offset = this.trailVertexCount * COMPONENTS_PER_TRAIL_VERTEX;
		this.trailVertexData[offset] = point.x;
		this.trailVertexData[offset + 1] = point.y;
		this.trailVertexData[offset + 2] = uv.u;
		this.trailVertexData[offset + 3] = uv.v;
		this.trailVertexData[offset + 4] = Math.max(0, color[0]);
		this.trailVertexData[offset + 5] = Math.max(0, color[1]);
		this.trailVertexData[offset + 6] = Math.max(0, color[2]);
		this.trailVertexData[offset + 7] = clamp$3(particleAlpha, 0, 1);
		this.trailVertexData[offset + 8] = clamp$3(coverageFactor, 0, 1);
		this.trailVertexCount++;
	}
	_appendRadialDisk(x, y, radius, segmentCount, ensureCapacity, appendVertex) {
		const segments = clamp$3(Math.round(segmentCount), 24, 128);
		const angleStep = Math.PI * 2 / segments;
		const cosineStep = Math.cos(angleStep);
		const sineStep = Math.sin(angleStep);
		let verticesPerSegment = 0;
		for (let ringIndex = 0; ringIndex < DISK_TEXTURE_RADIAL_STOPS.length - 1; ringIndex++) {
			const innerRadius = radius * DISK_TEXTURE_RADIAL_STOPS[ringIndex][0];
			verticesPerSegment += innerRadius <= DISK_CENTER_RADIUS_EPSILON ? 3 : 6;
		}
		ensureCapacity(segments * verticesPerSegment);
		for (let ringIndex = 0; ringIndex < DISK_TEXTURE_RADIAL_STOPS.length - 1; ringIndex++) {
			const inner = DISK_TEXTURE_RADIAL_STOPS[ringIndex];
			const outer = DISK_TEXTURE_RADIAL_STOPS[ringIndex + 1];
			const innerRadius = radius * inner[0];
			const outerRadius = radius * outer[0];
			let startCosine = 1;
			let startSine = 0;
			for (let segment = 0; segment < segments; segment++) {
				const lastSegment = segment === segments - 1;
				const endCosine = lastSegment ? 1 : startCosine * cosineStep - startSine * sineStep;
				const endSine = lastSegment ? 0 : startSine * cosineStep + startCosine * sineStep;
				const innerStartX = x + startCosine * innerRadius;
				const innerStartY = y + startSine * innerRadius;
				const innerEndX = x + endCosine * innerRadius;
				const innerEndY = y + endSine * innerRadius;
				const outerStartX = x + startCosine * outerRadius;
				const outerStartY = y + startSine * outerRadius;
				const outerEndX = x + endCosine * outerRadius;
				const outerEndY = y + endSine * outerRadius;
				if (innerRadius <= DISK_CENTER_RADIUS_EPSILON) {
					appendVertex(x, y, inner[1], inner[2]);
					appendVertex(outerEndX, outerEndY, outer[1], outer[2]);
					appendVertex(outerStartX, outerStartY, outer[1], outer[2]);
					startCosine = endCosine;
					startSine = endSine;
					continue;
				}
				appendVertex(innerStartX, innerStartY, inner[1], inner[2]);
				appendVertex(innerEndX, innerEndY, inner[1], inner[2]);
				appendVertex(outerEndX, outerEndY, outer[1], outer[2]);
				appendVertex(innerStartX, innerStartY, inner[1], inner[2]);
				appendVertex(outerEndX, outerEndY, outer[1], outer[2]);
				appendVertex(outerStartX, outerStartY, outer[1], outer[2]);
				startCosine = endCosine;
				startSine = endSine;
			}
		}
	}
	addSolidDisk(x, y, radius, color, opacity = 1, segmentCount = 48) {
		const red = color[0] * opacity;
		const green = color[1] * opacity;
		const blue = color[2] * opacity;
		if (radius <= 0 || Math.max(red, green, blue) <= 0) return;
		const segments = clamp$3(Math.round(segmentCount), 16, 128);
		const angleStep = Math.PI * 2 / segments;
		this._ensureVertexCapacity(segments * 3);
		for (let segment = 0; segment < segments; segment++) {
			const startAngle = segment * angleStep;
			const endAngle = (segment + 1) * angleStep;
			this._appendVertex(x, y, red, green, blue, opacity);
			this._appendVertex(x + Math.cos(endAngle) * radius, y + Math.sin(endAngle) * radius, red, green, blue, opacity);
			this._appendVertex(x + Math.cos(startAngle) * radius, y + Math.sin(startAngle) * radius, red, green, blue, opacity);
		}
	}
	addDisk(x, y, radius, color, opacity = 1, segmentCount = 64) {
		const red = color[0] * opacity;
		const green = color[1] * opacity;
		const blue = color[2] * opacity;
		if (radius <= 0 || Math.max(red, green, blue) <= 0) return;
		this._appendRadialDisk(x, y, radius, segmentCount, (count) => this._ensureVertexCapacity(count), (vertexX, vertexY, textureAlpha, energy) => {
			this._appendVertex(vertexX, vertexY, red * energy, green * energy, blue * energy, opacity * textureAlpha);
		});
	}
	addAlphaBlendDisk(x, y, radius, color, opacity = 1, particleAlpha = 1, rotation = 0, segmentCount = 64) {
		const red = color[0] * opacity;
		const green = color[1] * opacity;
		const blue = color[2] * opacity;
		const coverageOpacity = opacity * particleAlpha;
		if (radius <= 0 || Math.max(red, green, blue) <= 0) return;
		const angle = Number.isFinite(rotation) ? rotation : 0;
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		const appendCorner = (localX, localY, u, v) => {
			this._appendSceneDiskVertex(x + localX * cosine - localY * sine, y + localX * sine + localY * cosine, u, v, red, green, blue, coverageOpacity);
		};
		this._ensureSceneDiskVertexCapacity(6);
		appendCorner(-radius, -radius, 0, 0);
		appendCorner(radius, -radius, 1, 0);
		appendCorner(radius, radius, 1, 1);
		appendCorner(-radius, -radius, 0, 0);
		appendCorner(radius, radius, 1, 1);
		appendCorner(-radius, radius, 0, 1);
	}
	addSceneDisk(x, y, radius, color, opacity = 1, particleAlpha = 1, rotation = 0, segmentCount = 64) {
		this.addAlphaBlendDisk(x, y, radius, color, opacity, particleAlpha, rotation, segmentCount);
	}
	addTriangle(x, y, size, rotation, color, opacity = 1, textureFrame = 0, roundness = 0) {
		const particleAlpha = Number.isFinite(opacity) ? clamp$3(opacity, 0, 1) : 0;
		const red = Math.max(0, color?.[0] ?? 0);
		const green = Math.max(0, color?.[1] ?? 0);
		const blue = Math.max(0, color?.[2] ?? 0);
		if (size <= 0 || particleAlpha <= 0 || Math.max(red, green, blue) <= 0) return;
		const cosine = Math.cos(rotation);
		const sine = Math.sin(rotation);
		const halfSize = size * .5;
		const rotatePoint = (localX, localY) => ({
			x: x + localX * cosine - localY * sine,
			y: y + localX * sine + localY * cosine
		});
		const topLeft = rotatePoint(-halfSize, -halfSize);
		const topRight = rotatePoint(halfSize, -halfSize);
		const bottomRight = rotatePoint(halfSize, halfSize);
		const bottomLeft = rotatePoint(-halfSize, halfSize);
		const frame = resolveTriangleTextureFrame(textureFrame);
		const topV = frame === 1 ? 1 : 0;
		const bottomV = frame === 1 ? 0 : 1;
		this._ensureTriangleVertexCapacity(6);
		this._appendTriangleVertex(topLeft.x, topLeft.y, 0, topV, red, green, blue, particleAlpha, roundness);
		this._appendTriangleVertex(topRight.x, topRight.y, 1, topV, red, green, blue, particleAlpha, roundness);
		this._appendTriangleVertex(bottomRight.x, bottomRight.y, 1, bottomV, red, green, blue, particleAlpha, roundness);
		this._appendTriangleVertex(topLeft.x, topLeft.y, 0, topV, red, green, blue, particleAlpha, roundness);
		this._appendTriangleVertex(bottomRight.x, bottomRight.y, 1, bottomV, red, green, blue, particleAlpha, roundness);
		this._appendTriangleVertex(bottomLeft.x, bottomLeft.y, 0, bottomV, red, green, blue, particleAlpha, roundness);
	}
	addTexturedTrailTriangle(first, second, third, color, opacity = 1, coverageFactor = 1) {
		const perVertexColor = Array.isArray(color?.[0]);
		const firstColor = perVertexColor ? color[0] : color;
		const secondColor = perVertexColor ? color[1] : color;
		const thirdColor = perVertexColor ? color[2] : color;
		const particleAlpha = Number.isFinite(opacity) ? clamp$3(opacity, 0, 1) : 0;
		const perVertexCoverage = Array.isArray(coverageFactor);
		const firstCoverage = perVertexCoverage ? coverageFactor[0] : coverageFactor;
		const secondCoverage = perVertexCoverage ? coverageFactor[1] : coverageFactor;
		const thirdCoverage = perVertexCoverage ? coverageFactor[2] : coverageFactor;
		if (particleAlpha <= 0 || Math.max(firstCoverage, secondCoverage, thirdCoverage) <= 0) return;
		this._ensureTrailVertexCapacity(3);
		this._appendTrailVertex(first, first, firstColor, particleAlpha, firstCoverage);
		this._appendTrailVertex(second, second, secondColor, particleAlpha, secondCoverage);
		this._appendTrailVertex(third, third, thirdColor, particleAlpha, thirdCoverage);
	}
	addTrailTriangle(first, second, third, color, opacity = 1) {
		const perVertexColor = Array.isArray(color?.[0]);
		const firstColor = perVertexColor ? color[0] : color;
		const secondColor = perVertexColor ? color[1] : color;
		const thirdColor = perVertexColor ? color[2] : color;
		const firstRed = firstColor[0] * opacity;
		const firstGreen = firstColor[1] * opacity;
		const firstBlue = firstColor[2] * opacity;
		const secondRed = secondColor[0] * opacity;
		const secondGreen = secondColor[1] * opacity;
		const secondBlue = secondColor[2] * opacity;
		const thirdRed = thirdColor[0] * opacity;
		const thirdGreen = thirdColor[1] * opacity;
		const thirdBlue = thirdColor[2] * opacity;
		if (Math.max(firstRed, firstGreen, firstBlue, secondRed, secondGreen, secondBlue, thirdRed, thirdGreen, thirdBlue) <= 0) return;
		this._ensureVertexCapacity(3);
		this._appendVertex(first.x, first.y, firstRed, firstGreen, firstBlue, opacity);
		this._appendVertex(second.x, second.y, secondRed, secondGreen, secondBlue, opacity);
		this._appendVertex(third.x, third.y, thirdRed, thirdGreen, thirdBlue, opacity);
	}
	addDissolveRing(x, y, radius, width, rotation, radialSamples, segmentCount, materialColor, opacity, dissolveThreshold, textureUvMin, textureUvMax, dissolveDirection) {
		const red = materialColor[0] * opacity;
		const green = materialColor[1] * opacity;
		const blue = materialColor[2] * opacity;
		if (radius <= 0 || width <= 0 || Math.max(red, green, blue) <= 0) return;
		const bands = clamp$3(Math.round(radialSamples), 1, 32);
		const segments = clamp$3(Math.round(segmentCount), 32, 512);
		const innerEdge = Math.max(0, radius - width * .5);
		const bandWidth = width / bands;
		const cosine = new Float64Array(segments + 1);
		const sine = new Float64Array(segments + 1);
		const coverageOpacity = clamp$3(opacity, 0, 1);
		const safeThreshold = Number.isFinite(dissolveThreshold) ? clamp$3(dissolveThreshold, 0, 1) : 1;
		const safeUvMin = Number.isFinite(textureUvMin) ? clamp$3(textureUvMin, 0, 1) : 0;
		const uvSpan = (Number.isFinite(textureUvMax) ? clamp$3(textureUvMax, 0, 1) : 1) - safeUvMin;
		const direction = dissolveDirection >= 0 ? 1 : -1;
		for (let segment = 0; segment <= segments; segment++) {
			const angle = rotation + segment / segments * Math.PI * 2;
			cosine[segment] = Math.cos(angle);
			sine[segment] = Math.sin(angle);
		}
		this._ensureRingVertexCapacity(bands * segments * 6);
		for (let band = 0; band < bands; band++) {
			const innerRadius = innerEdge + bandWidth * band;
			const outerRadius = innerEdge + bandWidth * (band + 1);
			const innerV = safeUvMin + uvSpan * band / bands;
			const outerV = safeUvMin + uvSpan * (band + 1) / bands;
			for (let segment = 0; segment < segments; segment++) {
				const nextSegment = segment + 1;
				const innerStartX = x + cosine[segment] * innerRadius;
				const innerStartY = y + sine[segment] * innerRadius;
				const innerEndX = x + cosine[nextSegment] * innerRadius;
				const innerEndY = y + sine[nextSegment] * innerRadius;
				const outerStartX = x + cosine[segment] * outerRadius;
				const outerStartY = y + sine[segment] * outerRadius;
				const outerEndX = x + cosine[nextSegment] * outerRadius;
				const outerEndY = y + sine[nextSegment] * outerRadius;
				const startProgress = segment / segments;
				const endProgress = nextSegment / segments;
				const startTextureProgress = direction > 0 ? startProgress : 1 - startProgress;
				const endTextureProgress = direction > 0 ? endProgress : 1 - endProgress;
				const startU = safeUvMin + uvSpan * startTextureProgress;
				const endU = safeUvMin + uvSpan * endTextureProgress;
				this._appendRingVertex(innerStartX, innerStartY, startU, innerV, red, green, blue, safeThreshold, coverageOpacity);
				this._appendRingVertex(innerEndX, innerEndY, endU, innerV, red, green, blue, safeThreshold, coverageOpacity);
				this._appendRingVertex(outerEndX, outerEndY, endU, outerV, red, green, blue, safeThreshold, coverageOpacity);
				this._appendRingVertex(innerStartX, innerStartY, startU, innerV, red, green, blue, safeThreshold, coverageOpacity);
				this._appendRingVertex(outerEndX, outerEndY, endU, outerV, red, green, blue, safeThreshold, coverageOpacity);
				this._appendRingVertex(outerStartX, outerStartY, startU, outerV, red, green, blue, safeThreshold, coverageOpacity);
			}
		}
	}
	addRing(x, y, radius, width, rotation, radialSamples, segmentCount, materialColor, opacity, sampleLuminance) {
		if (width <= 0 || opacity <= 0) return;
		const bands = clamp$3(Math.round(radialSamples), 1, 32);
		const segments = clamp$3(Math.round(segmentCount), 32, 512);
		const innerEdge = Math.max(0, radius - width * .5);
		const bandWidth = width / bands;
		const red = materialColor[0] * opacity;
		const green = materialColor[1] * opacity;
		const blue = materialColor[2] * opacity;
		const angleStep = Math.PI * 2 / segments;
		const cosineStep = Math.cos(angleStep);
		const sineStep = Math.sin(angleStep);
		const rotationCosine = Math.cos(rotation);
		const rotationSine = Math.sin(rotation);
		this._ensureVertexCapacity(bands * segments * 6);
		for (let band = 0; band < bands; band++) {
			const innerRadius = innerEdge + bandWidth * band;
			const outerRadius = innerEdge + bandWidth * (band + 1);
			const radialProgress = (band + .5) / bands;
			let startCosine = rotationCosine;
			let startSine = rotationSine;
			let startLuminance = sampleLuminance(0, radialProgress);
			for (let segment = 0; segment < segments; segment++) {
				const endLuminance = sampleLuminance((segment + 1) / segments, radialProgress);
				const lastSegment = segment === segments - 1;
				const endCosine = lastSegment ? rotationCosine : startCosine * cosineStep - startSine * sineStep;
				const endSine = lastSegment ? rotationSine : startSine * cosineStep + startCosine * sineStep;
				if (startLuminance <= 0 && endLuminance <= 0) {
					startCosine = endCosine;
					startSine = endSine;
					startLuminance = endLuminance;
					continue;
				}
				const startRed = red * startLuminance;
				const startGreen = green * startLuminance;
				const startBlue = blue * startLuminance;
				const endRed = red * endLuminance;
				const endGreen = green * endLuminance;
				const endBlue = blue * endLuminance;
				const innerStartX = x + startCosine * innerRadius;
				const innerStartY = y + startSine * innerRadius;
				const innerEndX = x + endCosine * innerRadius;
				const innerEndY = y + endSine * innerRadius;
				const outerStartX = x + startCosine * outerRadius;
				const outerStartY = y + startSine * outerRadius;
				const outerEndX = x + endCosine * outerRadius;
				const outerEndY = y + endSine * outerRadius;
				this._appendVertex(innerStartX, innerStartY, startRed, startGreen, startBlue, opacity * startLuminance);
				this._appendVertex(innerEndX, innerEndY, endRed, endGreen, endBlue, opacity * endLuminance);
				this._appendVertex(outerEndX, outerEndY, endRed, endGreen, endBlue, opacity * endLuminance);
				this._appendVertex(innerStartX, innerStartY, startRed, startGreen, startBlue, opacity * startLuminance);
				this._appendVertex(outerEndX, outerEndY, endRed, endGreen, endBlue, opacity * endLuminance);
				this._appendVertex(outerStartX, outerStartY, startRed, startGreen, startBlue, opacity * startLuminance);
				startCosine = endCosine;
				startSine = endSine;
				startLuminance = endLuminance;
			}
		}
	}
	addTrailSegment(from, to, width, color, opacity = 1, transverseProfile = null, fromOffset = null, toOffset = null, capStart = false, capEnd = false) {
		const deltaX = to.x - from.x;
		const deltaY = to.y - from.y;
		const length = Math.hypot(deltaX, deltaY);
		const red = color[0] * opacity;
		const green = color[1] * opacity;
		const blue = color[2] * opacity;
		if (length <= 0 || width <= 0 || Math.max(red, green, blue) <= 0) return;
		const profile = Array.isArray(transverseProfile) && transverseProfile.length >= 2 ? transverseProfile : [[0, 1], [1, 1]];
		const halfWidth = width * .5;
		const defaultOffset = {
			x: -deltaY / length * halfWidth,
			y: deltaX / length * halfWidth
		};
		const startOffset = fromOffset ?? defaultOffset;
		const endOffset = toOffset ?? defaultOffset;
		this._ensureVertexCapacity((profile.length - 1) * 6 + (capStart ? 3 : 0) + (capEnd ? 3 : 0));
		for (let index = 1; index < profile.length; index++) {
			const previous = profile[index - 1];
			const current = profile[index];
			const previousOffsetScale = 1 - previous[0] * 2;
			const currentOffsetScale = 1 - current[0] * 2;
			const previousFromX = from.x + startOffset.x * previousOffsetScale;
			const previousFromY = from.y + startOffset.y * previousOffsetScale;
			const previousToX = to.x + endOffset.x * previousOffsetScale;
			const previousToY = to.y + endOffset.y * previousOffsetScale;
			const currentFromX = from.x + startOffset.x * currentOffsetScale;
			const currentFromY = from.y + startOffset.y * currentOffsetScale;
			const currentToX = to.x + endOffset.x * currentOffsetScale;
			const currentToY = to.y + endOffset.y * currentOffsetScale;
			const previousRed = red * previous[1];
			const previousGreen = green * previous[1];
			const previousBlue = blue * previous[1];
			const currentRed = red * current[1];
			const currentGreen = green * current[1];
			const currentBlue = blue * current[1];
			this._appendVertex(previousFromX, previousFromY, previousRed, previousGreen, previousBlue, opacity);
			this._appendVertex(previousToX, previousToY, previousRed, previousGreen, previousBlue, opacity);
			this._appendVertex(currentToX, currentToY, currentRed, currentGreen, currentBlue, opacity);
			this._appendVertex(previousFromX, previousFromY, previousRed, previousGreen, previousBlue, opacity);
			this._appendVertex(currentToX, currentToY, currentRed, currentGreen, currentBlue, opacity);
			this._appendVertex(currentFromX, currentFromY, currentRed, currentGreen, currentBlue, opacity);
		}
		if (!capStart && !capEnd) return;
		const tangentX = deltaX / length;
		const tangentY = deltaY / length;
		const centerIntensity = profile.reduce((maximum, [, intensity]) => Math.max(maximum, intensity), 0);
		const centerRed = red * centerIntensity;
		const centerGreen = green * centerIntensity;
		const centerBlue = blue * centerIntensity;
		if (capStart) {
			this._appendVertex(from.x + startOffset.x, from.y + startOffset.y, centerRed, centerGreen, centerBlue, opacity);
			this._appendVertex(from.x - startOffset.x, from.y - startOffset.y, centerRed, centerGreen, centerBlue, opacity);
			this._appendVertex(from.x - tangentX * halfWidth, from.y - tangentY * halfWidth, centerRed, centerGreen, centerBlue, opacity);
		}
		if (capEnd) {
			this._appendVertex(to.x + endOffset.x, to.y + endOffset.y, centerRed, centerGreen, centerBlue, opacity);
			this._appendVertex(to.x + tangentX * halfWidth, to.y + tangentY * halfWidth, centerRed, centerGreen, centerBlue, opacity);
			this._appendVertex(to.x - endOffset.x, to.y - endOffset.y, centerRed, centerGreen, centerBlue, opacity);
		}
	}
	_bindTexture(program, name, texture, unit) {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(gl.getUniformLocation(program, name), unit);
	}
	_drawFullscreen(program, target, width, height) {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
		gl.viewport(0, 0, width, height);
		gl.useProgram(program);
		gl.bindVertexArray(this.fullscreenVao);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}
	_renderEmission(settings) {
		const gl = this.gl;
		const transparentOverlay = settings.outputCompositing === "browser-overlay";
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.sourceTarget.framebuffer);
		gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		this._drawGeometryBatches(this.programs.emission, transparentOverlay);
	}
	_renderPrefilter(settings) {
		const gl = this.gl;
		const program = this.programs.prefilter;
		const level = this.levels[0];
		const sourceTarget = this.bloomSourceFrameReady ? this.bloomSourceTarget : this.sourceTarget;
		const softKnee = Number.isFinite(settings.softKnee) ? clamp$3(settings.softKnee, 0, 1) : 0;
		const clampMax = resolveUnityBloomClamp(settings.clamp);
		gl.useProgram(program);
		this._bindTexture(program, "u_source", sourceTarget.texture, 0);
		gl.uniform2f(gl.getUniformLocation(program, "u_sourceTexel"), 1 / this.sourceWidth, 1 / this.sourceHeight);
		gl.uniform1f(gl.getUniformLocation(program, "u_threshold"), gammaToLinear(settings.threshold));
		gl.uniform1f(gl.getUniformLocation(program, "u_softKnee"), softKnee);
		gl.uniform1f(gl.getUniformLocation(program, "u_clampMax"), clampMax);
		this._drawFullscreen(program, level.down, level.width, level.height);
	}
	_renderSceneOverlay() {
		if (!this.sourceTarget || !this.sceneOverlayTarget || !this.programs?.sceneOverlay) return false;
		const program = this.programs.sceneOverlay;
		this.gl.useProgram(program);
		this._bindTexture(program, "u_scene", this.sourceTarget.texture, 0);
		this._drawFullscreen(program, this.sceneOverlayTarget, this.sourceWidth, this.sourceHeight);
		return true;
	}
	_renderDownsample(sourceLevel, targetLevel) {
		const gl = this.gl;
		const program = this.programs.downsample;
		gl.useProgram(program);
		this._bindTexture(program, "u_source", sourceLevel.down.texture, 0);
		gl.uniform2f(gl.getUniformLocation(program, "u_sourceTexel"), 1 / sourceLevel.width, 1 / sourceLevel.height);
		this._drawFullscreen(program, targetLevel.down, targetLevel.width, targetLevel.height);
	}
	_renderUpsample(fineLevel, accumulatedCoarseLevel, accumulatedCoarseTexture) {
		const gl = this.gl;
		const program = this.programs.upsample;
		gl.useProgram(program);
		this._bindTexture(program, "u_accumulatedCoarse", accumulatedCoarseTexture, 0);
		this._bindTexture(program, "u_currentFine", fineLevel.down.texture, 1);
		gl.uniform2f(gl.getUniformLocation(program, "u_accumulatedCoarseTexel"), 1 / accumulatedCoarseLevel.width, 1 / accumulatedCoarseLevel.height);
		gl.uniform1f(gl.getUniformLocation(program, "u_sampleScale"), this.sampleScale);
		this._drawFullscreen(program, fineLevel.up, fineLevel.width, fineLevel.height);
		return fineLevel.up.texture;
	}
	_renderFinal(texture, settings, hasScene = false, hasBackground = false, hasSceneOverlay = false) {
		const gl = this.gl;
		const program = this.programs.final;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.disable(gl.BLEND);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.useProgram(program);
		this._bindTexture(program, "u_bloom", texture, 0);
		this._bindTexture(program, "u_scene", hasScene ? hasSceneOverlay ? this.sceneOverlayTarget.texture : this.sourceTarget.texture : texture, 1);
		this._bindTexture(program, "u_background", hasBackground ? this.sceneBackgroundTarget.texture : texture, 2);
		this._bindTexture(program, "u_sceneEnergy", hasScene ? this.sourceTarget.texture : texture, 3);
		gl.uniform1i(gl.getUniformLocation(program, "u_hasScene"), hasScene ? 1 : 0);
		gl.uniform1i(gl.getUniformLocation(program, "u_hasBackground"), hasBackground ? 1 : 0);
		gl.uniform1i(gl.getUniformLocation(program, "u_transparentOverlay"), settings.outputCompositing === "browser-overlay" ? 1 : 0);
		gl.uniform1i(gl.getUniformLocation(program, "u_visualMaxAlpha"), settings.overlayAlphaPolicy === "visual-max" ? 1 : 0);
		gl.uniform1i(gl.getUniformLocation(program, "u_brightUnknownBackground"), settings.overlayColorCompensation === "bright-core" ? 1 : 0);
		gl.uniform1i(gl.getUniformLocation(program, "u_hostAdditive"), isIndependentHostCompositing(settings.hostCompositing) ? 1 : 0);
		gl.uniform2f(gl.getUniformLocation(program, "u_bloomTexel"), 1 / this.width, 1 / this.height);
		gl.uniform1f(gl.getUniformLocation(program, "u_sampleScale"), this.sampleScale);
		gl.uniform1f(gl.getUniformLocation(program, "u_intensity"), resolveUnityBloomIntensity(settings.intensity));
		gl.uniform1f(gl.getUniformLocation(program, "u_overlayAlphaLimit"), clamp$3(settings.overlayAlphaLimit ?? 1, 0, 1));
		gl.uniform1f(gl.getUniformLocation(program, "u_opacity"), clamp$3(settings.opacity ?? 1, 0, 1));
		gl.bindVertexArray(this.fullscreenVao);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}
	render(settings, options = {}) {
		if (!this.available || this.contextLost || !this.sourceTarget || this.levels.length === 0) return false;
		const gl = this.gl;
		const preserveCanvas = options.preserveCanvas === true;
		const hasScene = preserveCanvas && this.sceneEnabled && this.sceneFrameReady;
		const hasBackground = hasScene && this.sceneBackgroundFrameReady;
		const hasSceneOverlay = hasScene && !hasBackground && settings.outputCompositing === "browser-overlay" && !isIndependentHostCompositing(settings.hostCompositing) && this.sceneOverlayFrameReady;
		try {
			if (!this._hasGeometry() && !hasScene) {
				if (!preserveCanvas) this.clear();
				return true;
			}
			if (!hasScene) this._renderEmission(settings);
			this._renderPrefilter(settings);
			for (let level = 1; level < this.levels.length; level++) this._renderDownsample(this.levels[level - 1], this.levels[level]);
			let bloomTexture = this.levels.at(-1).down.texture;
			for (let level = this.levels.length - 2; level >= 0; level--) bloomTexture = this._renderUpsample(this.levels[level], this.levels[level + 1], bloomTexture);
			this._renderFinal(bloomTexture, settings, hasScene, hasBackground, hasSceneOverlay);
			this.stats.vertexCount = this.vertexCount + this.triangleVertexCount + this.trailVertexCount;
			this.stats.diskVertexCount = this.sceneDiskVertexCount;
			this.stats.ringVertexCount = this.ringVertexCount;
			this.stats.triangleVertexCount = this.triangleVertexCount;
			this.stats.trailVertexCount = this.trailVertexCount;
			const error = gl.getError();
			if (error !== gl.NO_ERROR) throw new Error(`WebGL2 错误码 ${error}`);
			return true;
		} catch (error) {
			console.warn("[BAClickFX] WebGL2 Scene 渲染失败:", error);
			this.clear();
			this._deleteTargets();
			this.available = false;
			return false;
		}
	}
	clear() {
		this.sceneFrameReady = false;
		this.bloomSourceFrameReady = false;
		this.sceneBackgroundFrameReady = false;
		this.stats.vertexCount = 0;
		this.stats.diskVertexCount = 0;
		this.stats.ringVertexCount = 0;
		this.stats.triangleVertexCount = 0;
		this.stats.trailVertexCount = 0;
		this.stats.sceneVertexCount = 0;
		this.stats.sceneDiskVertexCount = 0;
		this.stats.sceneRingVertexCount = 0;
		this.stats.sceneTriangleVertexCount = 0;
		this.stats.sceneTrailVertexCount = 0;
		if (!this.gl || this.contextLost) return;
		this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
		this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		this.gl.clearColor(0, 0, 0, 0);
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}
	destroy() {
		this.canvas?.removeEventListener?.("webglcontextlost", this._onContextLost);
		this.canvas?.removeEventListener?.("webglcontextrestored", this._onContextRestored);
		this._deleteResources();
		this.available = false;
		this.contextLost = false;
		this.vertexCount = 0;
		this.vertexData = /* @__PURE__ */ new Float32Array(0);
		this.sceneDiskVertexCount = 0;
		this.sceneDiskVertexData = /* @__PURE__ */ new Float32Array(0);
		this.ringVertexCount = 0;
		this.ringVertexData = /* @__PURE__ */ new Float32Array(0);
		this.triangleVertexCount = 0;
		this.triangleVertexData = /* @__PURE__ */ new Float32Array(0);
		this.trailVertexCount = 0;
		this.trailVertexData = /* @__PURE__ */ new Float32Array(0);
		this.maximumTextureSize = 0;
		this.maximumViewportWidth = 0;
		this.maximumViewportHeight = 0;
		this.failedResizeSignature = null;
		this.sceneBackgroundSource = null;
		this.sceneBackgroundWidth = 0;
		this.sceneBackgroundHeight = 0;
		this.sceneBackgroundUploadRetryPending = false;
	}
};
//#endregion
//#region src/webgpu-device.js
const STANDARD_CANVAS_FORMAT = "bgra8unorm";
const DIAGNOSTIC_STAGE_NAMES = Object.freeze([
	"gpuApi",
	"context",
	"adapter",
	"device",
	"extendedConfigure",
	"standardConfigure",
	"deviceLost",
	"unconfigure"
]);
const CONFIGURATION_FAILURE_STAGES = /* @__PURE__ */ new Set([
	"extended-configure-failed",
	"standard-configure-failed",
	"unconfigure-failed"
]);
function createDiagnosticStage() {
	return {
		status: "idle",
		failureStage: null,
		error: null
	};
}
function freezeDiagnosticStage(stage) {
	return Object.freeze({
		status: stage.status,
		failureStage: stage.failureStage,
		error: stage.error
	});
}
function getDefaultGpu() {
	return globalThis.navigator?.gpu ?? null;
}
function getPreferredCanvasFormat(gpu) {
	try {
		return gpu?.getPreferredCanvasFormat?.() ?? STANDARD_CANVAS_FORMAT;
	} catch {
		return STANDARD_CANVAS_FORMAT;
	}
}
/**
* 管理 WebGPU 的异步设备生命周期和 Canvas 输出合同。
* Renderer 只在 ready 后创建资源，设备丢失则由宿主决定回退与重试时机。
*/
var WebGPUCanvasDevice = class {
	constructor(canvas, options = {}) {
		this.canvas = canvas;
		this.gpu = options.gpu ?? getDefaultGpu();
		this.powerPreference = options.powerPreference ?? "high-performance";
		this.onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : null;
		this.context = null;
		this.adapter = null;
		this.device = null;
		this.status = "pending";
		this.outputMode = "unconfigured";
		this.canvasFormat = null;
		this.preferHdr = null;
		this.failure = null;
		this._diagnosticFailureStage = null;
		this._diagnosticStages = Object.fromEntries(DIAGNOSTIC_STAGE_NAMES.map((name) => [name, createDiagnosticStage()]));
		this.ready = this._initialize();
	}
	get available() {
		return this.status === "ready";
	}
	get hdrOutput() {
		return this.outputMode === "extended";
	}
	/**
	* 返回不可变快照，防止展示层意外改写设备状态。Error/DeviceLostInfo
	* 保留原对象，便于诊断浏览器提供的详细原因。
	*/
	get diagnostics() {
		const stages = Object.fromEntries(DIAGNOSTIC_STAGE_NAMES.map((name) => [name, freezeDiagnosticStage(this._diagnosticStages[name])]));
		return Object.freeze({
			failureStage: this._diagnosticFailureStage,
			stages: Object.freeze(stages)
		});
	}
	_setDiagnosticStage(name, status, failureStage = null, error = null) {
		const stage = this._diagnosticStages[name];
		if (!stage) return;
		stage.status = status;
		stage.failureStage = failureStage;
		stage.error = error;
	}
	_failDiagnosticStage(name, failureStage, error) {
		this._setDiagnosticStage(name, "failed", failureStage, error);
		this._diagnosticFailureStage = failureStage;
	}
	_resetConfigurationDiagnostics() {
		this._setDiagnosticStage("extendedConfigure", "idle");
		this._setDiagnosticStage("standardConfigure", "idle");
		this._setDiagnosticStage("unconfigure", "idle");
		if (CONFIGURATION_FAILURE_STAGES.has(this._diagnosticFailureStage)) this._diagnosticFailureStage = null;
	}
	_setStatus(status, failure = null) {
		if (this.status === status && this.failure === failure) return;
		this.status = status;
		this.failure = failure;
		this.onStateChange?.(status, this);
	}
	async _initialize() {
		try {
			this._setDiagnosticStage("gpuApi", "pending");
			if (!this.gpu || typeof this.gpu.requestAdapter !== "function") {
				const error = /* @__PURE__ */ new Error("当前环境未提供 WebGPU");
				this._failDiagnosticStage("gpuApi", "webgpu-api-missing", error);
				throw error;
			}
			this._setDiagnosticStage("gpuApi", "succeeded");
			this._setDiagnosticStage("context", "pending");
			try {
				this.context = this.canvas?.getContext?.("webgpu") ?? null;
			} catch (error) {
				this._failDiagnosticStage("context", "context-unavailable", error);
				throw error;
			}
			if (!this.context) {
				const error = /* @__PURE__ */ new Error("Canvas 无法创建 WebGPU 上下文");
				this._failDiagnosticStage("context", "context-unavailable", error);
				throw error;
			}
			this._setDiagnosticStage("context", "succeeded");
			this._setDiagnosticStage("adapter", "pending");
			try {
				this.adapter = await this.gpu.requestAdapter({ powerPreference: this.powerPreference });
			} catch (error) {
				this._failDiagnosticStage("adapter", "adapter-request-failed", error);
				throw error;
			}
			if (!this.adapter) {
				const error = /* @__PURE__ */ new Error("浏览器未返回 WebGPU Adapter");
				this._failDiagnosticStage("adapter", "adapter-unavailable", error);
				throw error;
			}
			this._setDiagnosticStage("adapter", "succeeded");
			this._setDiagnosticStage("device", "pending");
			try {
				this.device = await this.adapter.requestDevice();
			} catch (error) {
				this._failDiagnosticStage("device", "device-request-failed", error);
				throw error;
			}
			if (!this.device) {
				const error = /* @__PURE__ */ new Error("浏览器未返回 WebGPU Device");
				this._failDiagnosticStage("device", "device-request-failed", error);
				throw error;
			}
			this._setDiagnosticStage("device", "succeeded");
			this._watchDeviceLoss(this.device);
			this._setStatus("ready");
			return true;
		} catch (error) {
			if (this.status !== "destroyed") this._setStatus("unavailable", error);
			return false;
		}
	}
	_watchDeviceLoss(device) {
		if (!device?.lost || typeof device.lost.then !== "function") return;
		device.lost.then((info) => {
			if (this.status === "destroyed" || device !== this.device) return;
			this.outputMode = "unconfigured";
			this.canvasFormat = null;
			this.preferHdr = null;
			this._resetConfigurationDiagnostics();
			const failure = info ?? /* @__PURE__ */ new Error("WebGPU Device 已丢失");
			this._setDiagnosticStage("device", "lost", "device-lost", failure);
			this._setDiagnosticStage("deviceLost", "lost", "device-lost", failure);
			this._diagnosticFailureStage = "device-lost";
			this._setStatus("lost", failure);
		});
	}
	_configureExtended() {
		this.context.configure({
			device: this.device,
			format: "rgba16float",
			alphaMode: "premultiplied",
			toneMapping: { mode: "extended" }
		});
		this.canvasFormat = "rgba16float";
		this.outputMode = "extended";
	}
	_configureStandard() {
		const format = getPreferredCanvasFormat(this.gpu);
		this.context.configure({
			device: this.device,
			format,
			alphaMode: "premultiplied"
		});
		this.canvasFormat = format;
		this.outputMode = "standard";
	}
	configure(options = {}) {
		if (!this.available || !this.context || !this.device) return false;
		const preferHdr = options.preferHdr !== false;
		if (this.outputMode !== "unconfigured" && this.preferHdr === preferHdr) return true;
		this._resetConfigurationDiagnostics();
		if (preferHdr) {
			this._setDiagnosticStage("extendedConfigure", "pending");
			try {
				this._configureExtended();
				this._setDiagnosticStage("extendedConfigure", "succeeded");
				this._setDiagnosticStage("standardConfigure", "skipped");
				this.preferHdr = preferHdr;
				return true;
			} catch (error) {
				this._failDiagnosticStage("extendedConfigure", "extended-configure-failed", error);
			}
		} else this._setDiagnosticStage("extendedConfigure", "skipped");
		this._setDiagnosticStage("standardConfigure", "pending");
		try {
			this._configureStandard();
			this._setDiagnosticStage("standardConfigure", "succeeded");
			this.preferHdr = preferHdr;
			return true;
		} catch (error) {
			this.outputMode = "unconfigured";
			this.canvasFormat = null;
			this.preferHdr = null;
			this.failure = error;
			this._failDiagnosticStage("standardConfigure", "standard-configure-failed", error);
			return false;
		}
	}
	/**
	* 解除 Canvas 的展示配置，但保留 Adapter 与 Device，供再次选择 WebGPU
	* 时重新协商 HDR/SDR。隐藏的 Extended Surface 不能继续参与页面合成。
	*/
	unconfigure() {
		if (this.outputMode === "unconfigured" && this.canvasFormat === null && this.preferHdr === null) return true;
		this._setDiagnosticStage("unconfigure", "pending");
		try {
			this.context?.unconfigure?.();
		} catch (error) {
			this.failure = error;
			this._failDiagnosticStage("unconfigure", "unconfigure-failed", error);
			return false;
		}
		this.outputMode = "unconfigured";
		this.canvasFormat = null;
		this.preferHdr = null;
		this._setDiagnosticStage("extendedConfigure", "idle");
		this._setDiagnosticStage("standardConfigure", "idle");
		this._setDiagnosticStage("unconfigure", "succeeded");
		if (CONFIGURATION_FAILURE_STAGES.has(this._diagnosticFailureStage)) this._diagnosticFailureStage = null;
		return true;
	}
	destroy() {
		if (this.status === "destroyed") return;
		this._setStatus("destroyed");
		this.unconfigure();
		try {
			this.device?.destroy?.();
		} catch {}
		this.context = null;
		this.adapter = null;
		this.device = null;
		this.outputMode = "unconfigured";
		this.canvasFormat = null;
		this.preferHdr = null;
	}
};
//#endregion
//#region src/webgpu-shaders.js
const WEBGPU_GEOMETRY_SHADER = `
struct GeometryUniforms
{
  displaySize: vec2f,
  diskEmissionScale: f32,
  ringEmissionScale: f32,
  transparentOverlay: u32,
}

@group(0) @binding(0) var<uniform> geometry: GeometryUniforms;
@group(0) @binding(1) var materialTexture: texture_2d<f32>;
@group(0) @binding(2) var materialSampler: sampler;

struct GenericOutput
{
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) coverage: f32,
}

struct TexturedOutput
{
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) particleAlpha: f32,
  @location(3) coverageFactor: f32,
}

fn toClip(position: vec2f) -> vec4f
{
  let normalized = position / geometry.displaySize;
  return vec4f(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0,
  );
}

@vertex
fn vertexGeneric(
  @location(0) position: vec2f,
  @location(1) color: vec3f,
  @location(2) coverage: f32,
) -> GenericOutput
{
  var output: GenericOutput;
  output.position = toClip(position);
  output.color = color;
  output.coverage = coverage;
  return output;
}

@fragment
fn fragmentGeneric(input: GenericOutput) -> @location(0) vec4f
{
  let alpha = select(1.0, clamp(input.coverage, 0.0, 1.0),
    geometry.transparentOverlay != 0u);
  return vec4f(max(input.color, vec3f(0.0)), alpha);
}

@vertex
fn vertexTextured(
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec3f,
  @location(3) particleAlpha: f32,
  @location(4) coverageFactor: f32,
) -> TexturedOutput
{
  var output: TexturedOutput;
  output.position = toClip(position);
  output.uv = uv;
  output.color = color;
  output.particleAlpha = particleAlpha;
  output.coverageFactor = coverageFactor;
  return output;
}

@vertex
fn vertexDisk(
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec3f,
  @location(3) particleAlpha: f32,
) -> TexturedOutput
{
  var output: TexturedOutput;
  output.position = toClip(position);
  output.uv = uv;
  output.color = color;
  output.particleAlpha = particleAlpha;
  output.coverageFactor = 1.0;
  return output;
}

fn sdTriangle(point: vec2f) -> f32
{
  let vertices = array<vec2f, 3>(
    vec2f(-0.9609375, -0.7265625),
    vec2f(0.9609375, -0.7265625),
    vec2f(0.0, 0.9140625),
  );
  var minimumSquaredDistance = 1.0e20;
  var inside = true;

  for (var index = 0u; index < 3u; index++)
  {
    let start = vertices[index];
    let end = vertices[(index + 1u) % 3u];
    let edge = end - start;
    let offset = point - start;
    let progress = clamp(
      dot(offset, edge) / max(dot(edge, edge), 1.0e-20),
      0.0,
      1.0,
    );
    let nearest = offset - edge * progress;

    minimumSquaredDistance = min(
      minimumSquaredDistance,
      dot(nearest, nearest),
    );
    inside = inside && edge.x * offset.y - edge.y * offset.x >= 0.0;
  }

  return sqrt(minimumSquaredDistance) * select(1.0, -1.0, inside);
}

fn sdRoundedTriangle(point: vec2f, roundness: f32) -> f32
{
  if (roundness >= 1.0)
  {
    return length(point) - 1.0;
  }

  let triangleScale = max(1.0 - roundness, 0.000001);

  // 缩小真实图集三角与圆盘的 Minkowski 和只磨圆角，仍保留直边。
  return sdTriangle(point / triangleScale) *
    triangleScale - roundness;
}

@fragment
fn fragmentTriangle(input: TexturedOutput) -> @location(0) vec4f
{
  let roundness = clamp(input.coverageFactor, 0.0, 1.0);
  let point = input.uv * 2.0 - 1.0;
  let samplePoint = point / (1.0 + 1.16465 * roundness);
  var sampleColor = textureSample(
    materialTexture,
    materialSampler,
    samplePoint * 0.5 + 0.5,
  );
  let particleAlpha = clamp(input.particleAlpha, 0.0, 1.0);
  let distance = sdRoundedTriangle(point, roundness);
  // 导数必须在一致控制流中计算，否则 WebGPU 验证会拒绝该 Shader。
  let footprint = max(fwidth(distance), 0.000001);
  let roundedCoverage = 1.0 - smoothstep(-footprint, footprint, distance);
  let textureSupport = clamp(sampleColor.a, 0.0, 1.0);
  let supportedRgb = mix(vec3f(1.0), sampleColor.rgb, textureSupport);
  let shapeRgb = mix(supportedRgb, vec3f(1.0), roundness);
  let shapeAlpha = select(
    sampleColor.a,
    roundedCoverage,
    roundness > 0.0,
  );

  sampleColor = vec4f(
    select(sampleColor.rgb, shapeRgb, roundness > 0.0),
    shapeAlpha,
  );

  let coverage = sampleColor.a * particleAlpha;
  let emission = sampleColor.rgb * max(input.color, vec3f(0.0)) * coverage;
  let alpha = select(1.0, coverage, geometry.transparentOverlay != 0u);
  return vec4f(emission, alpha);
}

@fragment
fn fragmentTrail(input: TexturedOutput) -> @location(0) vec4f
{
  let sampleColor = textureSample(materialTexture, materialSampler, input.uv);
  let particleAlpha = clamp(input.particleAlpha, 0.0, 1.0);
  let edgeDistance = min(input.uv.y, 1.0 - input.uv.y);
  let footprint = max(fwidth(input.uv.y) * 0.5, 0.000001);
  let geometryCoverage = select(
    1.0,
    smoothstep(0.0, footprint, edgeDistance),
    geometry.transparentOverlay != 0u,
  );
  let coverage = sampleColor.a * particleAlpha *
    clamp(input.coverageFactor, 0.0, 1.0) * geometryCoverage;
  let emission = sampleColor.rgb * max(input.color, vec3f(0.0)) * particleAlpha;
  let alpha = select(1.0, coverage, geometry.transparentOverlay != 0u);
  return vec4f(emission, alpha);
}

@fragment
fn fragmentDisk(input: TexturedOutput) -> @location(0) vec4f
{
  let sampleColor = textureSample(materialTexture, materialSampler, input.uv);
  let textureAlpha = sampleColor.r;
  let color = sampleColor.rgb * max(input.color, vec3f(0.0)) *
    textureAlpha * max(geometry.diskEmissionScale, 0.0);
  let alpha = textureAlpha * clamp(input.particleAlpha, 0.0, 1.0);
  return vec4f(color, clamp(alpha, 0.0, 1.0));
}

struct RingOutput
{
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) dissolveThreshold: f32,
  @location(3) coverageOpacity: f32,
}

@vertex
fn vertexRing(
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec3f,
  @location(3) dissolveThreshold: f32,
  @location(4) coverageOpacity: f32,
) -> RingOutput
{
  var output: RingOutput;
  output.position = toClip(position);
  output.uv = uv;
  output.color = color;
  output.dissolveThreshold = dissolveThreshold;
  output.coverageOpacity = coverageOpacity;
  return output;
}

@fragment
fn fragmentRing(input: RingOutput) -> @location(0) vec4f
{
  let textureAlpha = textureSample(
    materialTexture,
    materialSampler,
    input.uv,
  ).r;

  if (textureAlpha < input.dissolveThreshold)
  {
    discard;
  }

  let alpha = clamp(textureAlpha, 0.0, 1.0);
  let color = max(input.color, vec3f(0.0)) *
    max(geometry.ringEmissionScale, 0.0);

  if (geometry.transparentOverlay != 0u)
  {
    return vec4f(color * alpha, alpha * clamp(input.coverageOpacity, 0.0, 1.0));
  }

  return vec4f(color, alpha);
}
`;
const WEBGPU_FULLSCREEN_SHADER = `
struct PassUniforms
{
  texelSize: vec2f,
  backgroundUvScale: vec2f,
  sampleScale: f32,
  threshold: f32,
  softKnee: f32,
  clampMax: f32,
  intensity: f32,
  overlayAlphaLimit: f32,
  opacity: f32,
  hasScene: u32,
  hasBackground: u32,
  transparentOverlay: u32,
  visualMaxAlpha: u32,
  brightUnknownBackground: u32,
  hostAdditive: u32,
  extendedOutput: u32,
  hdrPeak: f32,
  hdrWhiteCore: f32,
  hdrWhiteStart: f32,
  hdrWhiteEnd: f32,
  hdrBrightness: f32,
  hdrColorPreservation: f32,
}

@group(0) @binding(0) var<uniform> params: PassUniforms;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var source0: texture_2d<f32>;
@group(0) @binding(3) var source1: texture_2d<f32>;
@group(0) @binding(4) var source2: texture_2d<f32>;
@group(0) @binding(5) var source3: texture_2d<f32>;

struct FullscreenOutput
{
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertexFullscreen(@builtin(vertex_index) index: u32) -> FullscreenOutput
{
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let position = positions[index];
  var output: FullscreenOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  return output;
}

fn sampleBox(source: texture_2d<f32>, uv: vec2f, offset: vec2f) -> vec4f
{
  return (
    textureSampleLevel(source, linearSampler, uv + vec2f(-offset.x, -offset.y), 0.0) +
    textureSampleLevel(source, linearSampler, uv + vec2f(offset.x, -offset.y), 0.0) +
    textureSampleLevel(source, linearSampler, uv + vec2f(-offset.x, offset.y), 0.0) +
    textureSampleLevel(source, linearSampler, uv + vec2f(offset.x, offset.y), 0.0)
  ) * 0.25;
}

@fragment
fn fragmentBackground(input: FullscreenOutput) -> @location(0) vec4f
{
  let uv = (input.uv - vec2f(0.5)) * params.backgroundUvScale + vec2f(0.5);
  return vec4f(textureSampleLevel(source0, linearSampler, uv, 0.0).rgb, 1.0);
}

@fragment
fn fragmentSceneOverlay(input: FullscreenOutput) -> @location(0) vec4f
{
  let scene = textureSampleLevel(source0, linearSampler, input.uv, 0.0);
  let coverage = clamp(scene.a, 0.0, 1.0);
  let capacity = select(
    pow((coverage + 0.055) / 1.055, 2.4),
    coverage / 12.92,
    coverage <= 0.04045,
  );
  let maximumEnergy = max(max(scene.r, scene.g), scene.b);
  let scale = min(1.0, capacity / max(maximumEnergy, 0.000001));
  return vec4f(scene.rgb * scale, coverage);
}

@fragment
fn fragmentPrefilter(input: FullscreenOutput) -> @location(0) vec4f
{
  let filtered = sampleBox(source0, input.uv, params.texelSize);
  let color = min(filtered.rgb, vec3f(min(max(params.clampMax, 0.0), 65504.0)));
  let brightness = max(max(color.r, color.g), color.b);

  if (brightness <= 0.0)
  {
    return vec4f(0.0);
  }

  let threshold = max(0.0, params.threshold);
  let knee = threshold * clamp(params.softKnee, 0.0, 1.0) + 0.00001;
  var soft = clamp(brightness - threshold + knee, 0.0, knee * 2.0);
  soft = soft * soft / (knee * 4.0);
  let contribution = max(max(brightness - threshold, soft), 0.0);
  return vec4f(color * contribution / max(brightness, 0.0001), contribution);
}

@fragment
fn fragmentDownsample(input: FullscreenOutput) -> @location(0) vec4f
{
  return sampleBox(source0, input.uv, params.texelSize);
}

@fragment
fn fragmentUpsample(input: FullscreenOutput) -> @location(0) vec4f
{
  let offset = params.texelSize * (params.sampleScale * 0.5);
  let coarse = sampleBox(source0, input.uv, offset);
  let fine = textureSampleLevel(source1, linearSampler, input.uv, 0.0);
  return coarse + fine;
}

fn linearToExtendedSrgb(value: f32) -> f32
{
  let linear = max(value, 0.0);
  return select(
    1.055 * pow(linear, 1.0 / 2.4) - 0.055,
    linear * 12.92,
    linear <= 0.0031308,
  );
}

fn linearToSrgb(value: f32) -> f32
{
  return min(linearToExtendedSrgb(value), 1.0);
}

fn linearToSrgb3(value: vec3f) -> vec3f
{
  return vec3f(
    linearToSrgb(value.r),
    linearToSrgb(value.g),
    linearToSrgb(value.b),
  );
}

fn linearToExtendedSrgb3(value: vec3f) -> vec3f
{
  return vec3f(
    linearToExtendedSrgb(value.r),
    linearToExtendedSrgb(value.g),
    linearToExtendedSrgb(value.b),
  );
}

fn mapExtendedHdrPresentation(linear: vec3f) -> vec3f
{
  let sdrBase = clamp(linear, vec3f(0.0), vec3f(1.0));
  let excess = max(linear - sdrBase, vec3f(0.0));
  let excessPeak = max(max(excess.r, excess.g), excess.b);

  if (excessPeak <= 0.0)
  {
    return sdrBase;
  }

  let capacity = max(params.hdrPeak - 1.0, 0.0);
  let mappedPeak = capacity * excessPeak /
    max(capacity + excessPeak, 0.000001);
  let coloredExtra = excess * mappedPeak / excessPeak;
  let whiteStart = max(params.hdrWhiteStart, 0.0);
  let whiteEnd = max(params.hdrWhiteEnd, whiteStart + 0.000001);
  let whiteMix = smoothstep(whiteStart, whiteEnd, excessPeak) *
    clamp(params.hdrWhiteCore, 0.0, 1.0);

  return sdrBase + mix(coloredExtra, vec3f(mappedPeak), whiteMix);
}

fn solveOverlayAlpha(background: f32, desired: f32) -> f32
{
  if (desired > background)
  {
    return (desired - background) / max(1.0 - background, 0.000001);
  }

  if (desired < background)
  {
    return (background - desired) / max(background, 0.000001);
  }

  return 0.0;
}

fn preserveHdrEffectHue(
  mapped: vec3f,
  source: vec3f,
  background: vec3f,
) -> vec3f
{
  let mappedDelta = max(mapped - background, vec3f(0.0));
  let sourceDelta = max(source - background, vec3f(0.0));
  let sourcePeak = max(max(sourceDelta.r, sourceDelta.g), sourceDelta.b);
  let targetPeak = max(max(mappedDelta.r, mappedDelta.g), mappedDelta.b);

  if (sourcePeak <= 0.000001 || targetPeak <= 0.000001)
  {
    return mappedDelta;
  }

  // 峰值仍来自 HDR shoulder，只把高亮增量拉回原始线性 RGB 色度方向。
  let preservedDelta = sourceDelta * targetPeak / sourcePeak;
  return mix(
    mappedDelta,
    preservedDelta,
    clamp(params.hdrColorPreservation, 0.0, 1.0),
  );
}

@fragment
fn fragmentFinal(input: FullscreenOutput) -> @location(0) vec4f
{
  let offset = params.texelSize * (params.sampleScale * 0.5);
  let filteredBloom = sampleBox(source0, input.uv, offset);
  let scene = select(
    vec4f(0.0),
    textureSampleLevel(source1, linearSampler, input.uv, 0.0),
    params.hasScene != 0u,
  );
  let sceneEnergy = select(
    vec4f(0.0),
    textureSampleLevel(source2, linearSampler, input.uv, 0.0),
    params.hasScene != 0u,
  );
  var sceneLinear = scene.rgb;

  if (
    params.transparentOverlay != 0u &&
    params.visualMaxAlpha != 0u &&
    params.hostAdditive == 0u &&
    params.hasScene != 0u
  )
  {
    sceneLinear = sceneEnergy.rgb;
  }

  let linear = sceneLinear + filteredBloom.rgb * max(0.0, params.intensity);
  let sceneCoverage = select(0.0, clamp(scene.a, 0.0, 1.0), params.hasScene != 0u);
  let bloomCoverage = linearToSrgb(
    max(0.0, filteredBloom.a) * max(0.0, params.intensity),
  );
  let requestedCoverage = select(
    sceneCoverage + bloomCoverage,
    max(sceneCoverage, bloomCoverage),
    params.visualMaxAlpha != 0u,
  );

  let backgroundUv = (input.uv - vec2f(0.5)) *
    params.backgroundUvScale + vec2f(0.5);
  let sampledBackground = textureSampleLevel(
    source3,
    linearSampler,
    backgroundUv,
    0.0,
  ).rgb;
  // Extended 输出需要独立展示映射；整体增益只放大背景上方的特效增量。
  let mappedExtendedLinear = mapExtendedHdrPresentation(linear);
  let presentationBackground = select(
    vec3f(0.0),
    sampledBackground,
    params.hasBackground != 0u,
  );
  let extendedEffectDelta = preserveHdrEffectHue(
    mappedExtendedLinear,
    linear,
    presentationBackground,
  );
  let extendedDisplayLinear = presentationBackground +
    extendedEffectDelta *
    clamp(params.hdrBrightness, 0.0, 32.0);
  let extendedSrgb = linearToExtendedSrgb3(extendedDisplayLinear);

  if (params.extendedOutput != 0u && params.hasBackground == 0u)
  {
    var alpha = clamp(
      max(
        requestedCoverage,
        max(max(extendedSrgb.r, extendedSrgb.g), extendedSrgb.b),
      ),
      0.0,
      1.0,
    );

    if (params.transparentOverlay != 0u && params.hostAdditive == 0u)
    {
      alpha = min(alpha, clamp(params.overlayAlphaLimit, 0.0, 1.0));
    }

    if (alpha <= 0.00001)
    {
      return vec4f(0.0);
    }

    // rgba16float Canvas 仍按 sRGB 编码解释；extended 只扩展可显示范围。
    return vec4f(extendedSrgb, alpha);
  }

  let srgb = linearToSrgb3(linear);

  if (params.extendedOutput != 0u && params.hasBackground != 0u)
  {
    let backgroundExtendedSrgb = linearToExtendedSrgb3(sampledBackground);
    let difference = abs(extendedSrgb - backgroundExtendedSrgb);

    if (max(max(difference.r, difference.g), difference.b) <= 0.00001)
    {
      return vec4f(0.0);
    }

    let channelAlpha = vec3f(
      solveOverlayAlpha(backgroundExtendedSrgb.r, extendedSrgb.r),
      solveOverlayAlpha(backgroundExtendedSrgb.g, extendedSrgb.g),
      solveOverlayAlpha(backgroundExtendedSrgb.b, extendedSrgb.b),
    );
    let alpha = clamp(
      max(max(channelAlpha.r, channelAlpha.g), channelAlpha.b),
      0.0,
      1.0,
    );
    let premultiplied = extendedSrgb -
      backgroundExtendedSrgb * (1.0 - alpha);

    // 在 Canvas 的 sRGB 编码域反解，避免 SDR 中间调在最终合成时变深。
    return vec4f(max(premultiplied, vec3f(0.0)), alpha);
  }

  if (params.hasBackground != 0u)
  {
    let backgroundSrgb = linearToSrgb3(sampledBackground);
    let difference = abs(srgb - backgroundSrgb);

    if (max(max(difference.r, difference.g), difference.b) <= 0.00001)
    {
      return vec4f(0.0);
    }

    let channelAlpha = vec3f(
      solveOverlayAlpha(backgroundSrgb.r, srgb.r),
      solveOverlayAlpha(backgroundSrgb.g, srgb.g),
      solveOverlayAlpha(backgroundSrgb.b, srgb.b),
    );
    let alpha = clamp(max(max(channelAlpha.r, channelAlpha.g), channelAlpha.b), 0.0, 1.0);
    let premultiplied = srgb - backgroundSrgb * (1.0 - alpha);
    return vec4f(clamp(premultiplied, vec3f(0.0), vec3f(alpha)), alpha);
  }

  if (params.transparentOverlay != 0u)
  {
    let capacity = min(requestedCoverage, 1.0);

    if (params.hostAdditive != 0u)
    {
      let alpha = clamp(max(max(max(srgb.r, srgb.g), srgb.b), capacity), 0.0, 1.0);
      return select(vec4f(srgb, alpha), vec4f(0.0), alpha <= 0.00001);
    }

    let alpha = min(capacity, clamp(params.overlayAlphaLimit, 0.0, 1.0));

    if (alpha <= 0.00001)
    {
      return vec4f(0.0);
    }

    let maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);
    let scale = select(
      min(1.0, alpha / max(capacity, 0.000001)),
      min(1.0, alpha / max(maximumSrgb, 0.000001)),
      params.visualMaxAlpha != 0u,
    );
    var premultiplied = srgb * scale;

    if (params.brightUnknownBackground != 0u)
    {
      let safeOpacity = max(params.opacity, 0.000001);
      let normalizedCoverage = clamp(alpha / safeOpacity, 0.0, 1.0);
      let maximumPremultiplied = max(
        max(premultiplied.r, premultiplied.g),
        premultiplied.b,
      );
      let normalizedEnergy = maximumPremultiplied / safeOpacity;
      let energyRatio = normalizedEnergy / max(normalizedCoverage, 0.000001);
      let gate = smoothstep(0.25, 0.75, energyRatio) *
        smoothstep(0.03125, 0.25, normalizedEnergy);

      premultiplied = mix(
        premultiplied,
        vec3f(maximumPremultiplied),
        0.35 * gate,
      );
    }

    return vec4f(premultiplied, alpha);
  }

  let maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);
  let alpha = select(
    maximumSrgb,
    max(clamp(scene.a, 0.0, 1.0), maximumSrgb),
    params.hasScene != 0u,
  );
  return select(vec4f(srgb, alpha), vec4f(0.0), maximumSrgb <= 0.00001 && alpha <= 0.00001);
}
`;
//#endregion
//#region src/webgpu-effect.js
const FLOAT_SIZE = Float32Array.BYTES_PER_ELEMENT;
const COMPONENTS_PER_VERTEX = 6;
const COMPONENTS_PER_DISK_VERTEX = 8;
const COMPONENTS_PER_RING_VERTEX = 9;
const COMPONENTS_PER_TEXTURED_VERTEX = 9;
const PASS_UNIFORM_SIZE = 96;
const GEOMETRY_UNIFORM_SIZE = 32;
const HDR_FORMAT = "rgba16float";
const TEXTURE_USAGE = globalThis.GPUTextureUsage ?? {
	COPY_DST: 2,
	TEXTURE_BINDING: 4,
	RENDER_ATTACHMENT: 16
};
const BUFFER_USAGE = globalThis.GPUBufferUsage ?? {
	COPY_DST: 8,
	VERTEX: 32,
	UNIFORM: 64
};
function clamp$2(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}
function getTexImageSourceDimensions(source) {
	if (!source) return null;
	try {
		const width = source.naturalWidth ?? source.videoWidth ?? source.displayWidth ?? source.width;
		const height = source.naturalHeight ?? source.videoHeight ?? source.displayHeight ?? source.height;
		if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return {
			width,
			height
		};
	} catch {}
	return null;
}
function nextBufferSize(required) {
	let size = 256;
	while (size < required) size *= 2;
	return size;
}
function destroyTexture(target) {
	target?.texture?.destroy?.();
}
function createTarget(device, width, height, label) {
	const texture = device.createTexture({
		label,
		size: {
			width,
			height
		},
		format: HDR_FORMAT,
		usage: TEXTURE_USAGE.RENDER_ATTACHMENT | TEXTURE_USAGE.TEXTURE_BINDING
	});
	return {
		width,
		height,
		texture,
		view: texture.createView()
	};
}
function createTextureFromBytes(device, width, height, format, data, label) {
	const texture = device.createTexture({
		label,
		size: {
			width,
			height
		},
		format,
		usage: TEXTURE_USAGE.COPY_DST | TEXTURE_USAGE.TEXTURE_BINDING
	});
	const bytesPerPixel = format === "r8unorm" ? 1 : 4;
	device.queue.writeTexture({ texture }, data, {
		bytesPerRow: width * bytesPerPixel,
		rowsPerImage: height
	}, {
		width,
		height
	});
	return texture;
}
function createVertexLayout(stride, attributes) {
	return {
		arrayStride: stride * FLOAT_SIZE,
		stepMode: "vertex",
		attributes: attributes.map(([shaderLocation, offset, format]) => ({
			shaderLocation,
			offset: offset * FLOAT_SIZE,
			format
		}))
	};
}
const GENERIC_VERTEX_LAYOUT = createVertexLayout(COMPONENTS_PER_VERTEX, [
	[
		0,
		0,
		"float32x2"
	],
	[
		1,
		2,
		"float32x3"
	],
	[
		2,
		5,
		"float32"
	]
]);
const TEXTURED_VERTEX_LAYOUT = createVertexLayout(COMPONENTS_PER_TEXTURED_VERTEX, [
	[
		0,
		0,
		"float32x2"
	],
	[
		1,
		2,
		"float32x2"
	],
	[
		2,
		4,
		"float32x3"
	],
	[
		3,
		7,
		"float32"
	],
	[
		4,
		8,
		"float32"
	]
]);
const DISK_VERTEX_LAYOUT = createVertexLayout(COMPONENTS_PER_DISK_VERTEX, [
	[
		0,
		0,
		"float32x2"
	],
	[
		1,
		2,
		"float32x2"
	],
	[
		2,
		4,
		"float32x3"
	],
	[
		3,
		7,
		"float32"
	]
]);
const RING_VERTEX_LAYOUT = createVertexLayout(COMPONENTS_PER_RING_VERTEX, [
	[
		0,
		0,
		"float32x2"
	],
	[
		1,
		2,
		"float32x2"
	],
	[
		2,
		4,
		"float32x3"
	],
	[
		3,
		7,
		"float32"
	],
	[
		4,
		8,
		"float32"
	]
]);
const ADDITIVE_BLEND = Object.freeze({
	color: {
		srcFactor: "one",
		dstFactor: "one",
		operation: "add"
	},
	alpha: {
		srcFactor: "one",
		dstFactor: "one-minus-src-alpha",
		operation: "add"
	}
});
const SCENE_ADDITIVE_BLEND = Object.freeze({
	color: {
		srcFactor: "one",
		dstFactor: "one",
		operation: "add"
	},
	alpha: {
		srcFactor: "zero",
		dstFactor: "one",
		operation: "add"
	}
});
const DISK_BLEND = Object.freeze({
	color: {
		srcFactor: "one",
		dstFactor: "one-minus-src-alpha",
		operation: "add"
	},
	alpha: {
		srcFactor: "one",
		dstFactor: "one-minus-src-alpha",
		operation: "add"
	}
});
const RING_SCENE_BLEND = Object.freeze({
	color: {
		srcFactor: "src-alpha",
		dstFactor: "one",
		operation: "add"
	},
	alpha: {
		srcFactor: "zero",
		dstFactor: "one",
		operation: "add"
	}
});
/**
* WebGPU 只替换 GPU 提交与 HDR 输出；粒子网格继续复用已经验证的 CPU 构建器。
* 等几何合同稳定后可将该构建器独立成更小的基类，不复制第二份粒子拓扑。
*/
var WebGPUEffectRenderer = class extends WebGL2EffectRenderer {
	constructor(canvas, options = {}) {
		super(canvas, { initialize: false });
		this.status = "pending";
		this.deviceManager = new WebGPUCanvasDevice(canvas, {
			gpu: options.gpu,
			onStateChange: (status, manager) => {
				if (manager === this.deviceManager) this._handleDeviceState(status, manager);
			}
		});
		this.onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : null;
		this.preferHdr = options.preferHdr !== false;
		this.device = null;
		this.context = null;
		this.geometryModule = null;
		this.fullscreenModule = null;
		this.sampler = null;
		this.geometryUniform = null;
		this.bloomGeometryUniform = null;
		this.backgroundUniform = null;
		this.prefilterUniform = null;
		this.finalUniform = null;
		this.vertexBuffers = {};
		this.textures = {};
		this.pipelines = null;
		this.finalPipeline = null;
		this.finalPipelineFormat = null;
		this.sceneBackgroundTexture = null;
		this.sceneBackgroundView = null;
		this.backgroundBindGroup = null;
		this.placeholderTexture = null;
		this.placeholderView = null;
		this.ready = this.deviceManager.ready.then((ready) => {
			if (!ready) {
				this._handleDeviceState(this.deviceManager.status, this.deviceManager);
				return false;
			}
			return this._initializeWebGPU();
		});
	}
	get hdrOutput() {
		return this.deviceManager.hdrOutput;
	}
	setPreferHdr(preferHdr) {
		const normalized = preferHdr !== false;
		if (this.preferHdr === normalized) return false;
		this.preferHdr = normalized;
		return true;
	}
	_setRendererStatus(status, error = null) {
		if (this.status === status && this.failure === error) return;
		this.status = status;
		this.failure = error;
		this.onStateChange?.(status, this);
	}
	_handleDeviceState(status, manager = this.deviceManager) {
		if (status === "lost") {
			this.available = false;
			this.contextLost = true;
			this._setRendererStatus("lost", manager.failure);
		} else if (status === "unavailable") this._setRendererStatus("unavailable", manager.failure);
	}
	_createUniformBuffer(label, size) {
		return this.device.createBuffer({
			label,
			size,
			usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST
		});
	}
	_createGeometryPipeline(vertexEntry, fragmentEntry, layout, blend) {
		return this.device.createRenderPipeline({
			layout: "auto",
			vertex: {
				module: this.geometryModule,
				entryPoint: vertexEntry,
				buffers: [layout]
			},
			fragment: {
				module: this.geometryModule,
				entryPoint: fragmentEntry,
				targets: [{
					format: HDR_FORMAT,
					blend
				}]
			},
			primitive: { topology: "triangle-list" }
		});
	}
	_createFullscreenPipeline(fragmentEntry, format = HDR_FORMAT) {
		return this.device.createRenderPipeline({
			layout: "auto",
			vertex: {
				module: this.fullscreenModule,
				entryPoint: "vertexFullscreen"
			},
			fragment: {
				module: this.fullscreenModule,
				entryPoint: fragmentEntry,
				targets: [{ format }]
			},
			primitive: { topology: "triangle-list" }
		});
	}
	async _initializeWebGPU() {
		if (this.status === "destroyed") return false;
		try {
			this.device = this.deviceManager.device;
			this.context = this.deviceManager.context;
			this.maximumTextureSize = this.device.limits?.maxTextureDimension2D ?? 8192;
			this.maximumViewportWidth = this.maximumTextureSize;
			this.maximumViewportHeight = this.maximumTextureSize;
			this.geometryModule = this.device.createShaderModule({
				label: "BA Click FX WebGPU geometry",
				code: WEBGPU_GEOMETRY_SHADER
			});
			this.fullscreenModule = this.device.createShaderModule({
				label: "BA Click FX WebGPU fullscreen",
				code: WEBGPU_FULLSCREEN_SHADER
			});
			const shaderErrors = (await Promise.all([this.geometryModule.getCompilationInfo?.(), this.fullscreenModule.getCompilationInfo?.()])).flatMap((info) => info?.messages?.filter((message) => message.type === "error") ?? []);
			if (shaderErrors.length > 0) throw new Error(shaderErrors.map((message) => `${message.lineNum ?? "?"}:${message.linePos ?? "?"} ` + message.message).join("\n"));
			this.sampler = this.device.createSampler({
				magFilter: "linear",
				minFilter: "linear",
				addressModeU: "clamp-to-edge",
				addressModeV: "clamp-to-edge"
			});
			this.geometryUniform = this._createUniformBuffer("BA Click FX geometry uniforms", GEOMETRY_UNIFORM_SIZE);
			this.bloomGeometryUniform = this._createUniformBuffer("BA Click FX scaled bloom geometry uniforms", GEOMETRY_UNIFORM_SIZE);
			this.backgroundUniform = this._createUniformBuffer("BA Click FX background uniforms", PASS_UNIFORM_SIZE);
			this.prefilterUniform = this._createUniformBuffer("BA Click FX prefilter uniforms", PASS_UNIFORM_SIZE);
			this.finalUniform = this._createUniformBuffer("BA Click FX final uniforms", PASS_UNIFORM_SIZE);
			this._createMaterialTextures();
			this.device.pushErrorScope?.("validation");
			this._createPipelines();
			const pipelineError = await this.device.popErrorScope?.();
			if (pipelineError) throw pipelineError;
			this.available = true;
			this.contextLost = false;
			this._setRendererStatus("ready");
			if (this.sceneBackgroundSource !== null) this._uploadSceneBackground();
			return true;
		} catch (error) {
			console.warn("[BAClickFX] WebGPU 资源初始化失败:", error);
			this.available = false;
			this._setRendererStatus("unavailable", error);
			return false;
		}
	}
	_createMaterialTextures() {
		this.textures.ring = createTextureFromBytes(this.device, 256, 128, "r8unorm", RING3_ALPHA, "BA Click FX Ring3");
		this.textures.circle = createTextureFromBytes(this.device, 512, 512, "rgba8unorm-srgb", CIRCLE_TEXTURE_RGBA, "BA Click FX Circle_01");
		this.textures.triangle = createTextureFromBytes(this.device, 128, 128, "rgba8unorm-srgb", TRIANGLE_TEXTURE_RGBA, "BA Click FX triangle");
		this.textures.triangleOverlay = createTextureFromBytes(this.device, 128, 128, "rgba8unorm-srgb", TRIANGLE_TEXTURE_OVERLAY_RGBA, "BA Click FX triangle overlay");
		this.textures.trail = createTextureFromBytes(this.device, 512, 512, "rgba8unorm-srgb", TRAIL_TEXTURE_RGBA, "BA Click FX Trail_03");
		this.placeholderTexture = createTextureFromBytes(this.device, 1, 1, "rgba8unorm", /* @__PURE__ */ new Uint8Array(4), "BA Click FX empty texture");
		this.placeholderView = this.placeholderTexture.createView();
	}
	_createPipelines() {
		this.pipelines = {
			genericOverlay: this._createGeometryPipeline("vertexGeneric", "fragmentGeneric", GENERIC_VERTEX_LAYOUT, ADDITIVE_BLEND),
			genericScene: this._createGeometryPipeline("vertexGeneric", "fragmentGeneric", GENERIC_VERTEX_LAYOUT, SCENE_ADDITIVE_BLEND),
			triangleOverlay: this._createGeometryPipeline("vertexTextured", "fragmentTriangle", TEXTURED_VERTEX_LAYOUT, ADDITIVE_BLEND),
			triangleScene: this._createGeometryPipeline("vertexTextured", "fragmentTriangle", TEXTURED_VERTEX_LAYOUT, SCENE_ADDITIVE_BLEND),
			trailOverlay: this._createGeometryPipeline("vertexTextured", "fragmentTrail", TEXTURED_VERTEX_LAYOUT, ADDITIVE_BLEND),
			trailScene: this._createGeometryPipeline("vertexTextured", "fragmentTrail", TEXTURED_VERTEX_LAYOUT, SCENE_ADDITIVE_BLEND),
			disk: this._createGeometryPipeline("vertexDisk", "fragmentDisk", DISK_VERTEX_LAYOUT, DISK_BLEND),
			ringOverlay: this._createGeometryPipeline("vertexRing", "fragmentRing", RING_VERTEX_LAYOUT, ADDITIVE_BLEND),
			ringScene: this._createGeometryPipeline("vertexRing", "fragmentRing", RING_VERTEX_LAYOUT, RING_SCENE_BLEND),
			background: this._createFullscreenPipeline("fragmentBackground"),
			sceneOverlay: this._createFullscreenPipeline("fragmentSceneOverlay"),
			prefilter: this._createFullscreenPipeline("fragmentPrefilter"),
			downsample: this._createFullscreenPipeline("fragmentDownsample"),
			upsample: this._createFullscreenPipeline("fragmentUpsample")
		};
	}
	_createPassUniform(values = {}) {
		const data = /* @__PURE__ */ new ArrayBuffer(PASS_UNIFORM_SIZE);
		const floats = new Float32Array(data);
		const integers = new Uint32Array(data);
		floats[0] = values.texelX ?? 1;
		floats[1] = values.texelY ?? 1;
		floats[2] = values.backgroundScaleX ?? 1;
		floats[3] = values.backgroundScaleY ?? 1;
		floats[4] = values.sampleScale ?? 1;
		floats[5] = values.threshold ?? 0;
		floats[6] = values.softKnee ?? 0;
		floats[7] = values.clampMax ?? 65504;
		floats[8] = values.intensity ?? 0;
		floats[9] = values.overlayAlphaLimit ?? 1;
		floats[10] = values.opacity ?? 1;
		integers[11] = values.hasScene ? 1 : 0;
		integers[12] = values.hasBackground ? 1 : 0;
		integers[13] = values.transparentOverlay ? 1 : 0;
		integers[14] = values.visualMaxAlpha ? 1 : 0;
		integers[15] = values.brightUnknownBackground ? 1 : 0;
		integers[16] = values.hostAdditive ? 1 : 0;
		integers[17] = values.extendedOutput ? 1 : 0;
		floats[18] = values.hdrPeak ?? WEBGPU_HDR_PRESENTATION_DEFAULTS.peak;
		floats[19] = values.hdrWhiteCore ?? WEBGPU_HDR_PRESENTATION_DEFAULTS.whiteCore;
		floats[20] = values.hdrWhiteStart ?? WEBGPU_HDR_PRESENTATION_DEFAULTS.whiteStart;
		floats[21] = values.hdrWhiteEnd ?? WEBGPU_HDR_PRESENTATION_DEFAULTS.whiteEnd;
		floats[22] = values.hdrBrightness ?? WEBGPU_HDR_PRESENTATION_DEFAULTS.brightness;
		floats[23] = values.hdrColorPreservation ?? WEBGPU_HDR_PRESENTATION_DEFAULTS.colorPreservation;
		return data;
	}
	_getBackgroundUvScale() {
		if (this.sceneBackgroundWidth <= 0 || this.sceneBackgroundHeight <= 0) return [1, 1];
		const sourceAspect = this.sceneBackgroundWidth / this.sceneBackgroundHeight;
		const displayAspect = this.displayWidth / this.displayHeight;
		return sourceAspect > displayAspect ? [displayAspect / sourceAspect, 1] : [1, sourceAspect / displayAspect];
	}
	_writeGeometryUniform(uniform, transparentOverlay, scales = {}) {
		const data = /* @__PURE__ */ new ArrayBuffer(GEOMETRY_UNIFORM_SIZE);
		const floats = new Float32Array(data);
		const integers = new Uint32Array(data);
		floats[0] = this.displayWidth;
		floats[1] = this.displayHeight;
		floats[2] = Math.max(0, scales.disk ?? 1);
		floats[3] = Math.max(0, scales.ring ?? 1);
		integers[4] = transparentOverlay ? 1 : 0;
		this.device.queue.writeBuffer(uniform, 0, data);
	}
	_ensureVertexBuffer(name, data, vertexCount, components) {
		if (vertexCount <= 0) return null;
		const byteLength = vertexCount * components * FLOAT_SIZE;
		let entry = this.vertexBuffers[name];
		if (!entry || entry.size < byteLength) {
			entry?.buffer?.destroy?.();
			const size = nextBufferSize(byteLength);
			entry = {
				size,
				buffer: this.device.createBuffer({
					label: `BA Click FX ${name} vertices`,
					size,
					usage: BUFFER_USAGE.VERTEX | BUFFER_USAGE.COPY_DST
				})
			};
			this.vertexBuffers[name] = entry;
		}
		this.device.queue.writeBuffer(entry.buffer, 0, data.buffer, data.byteOffset, byteLength);
		return entry.buffer;
	}
	_createGeometryBindGroup(pipeline, uniform, texture = null) {
		const entries = [{
			binding: 0,
			resource: { buffer: uniform }
		}];
		if (texture) entries.push({
			binding: 1,
			resource: texture.createView()
		}, {
			binding: 2,
			resource: this.sampler
		});
		return this.device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries
		});
	}
	_drawBatch(pass, pipeline, uniform, name, data, count, components, texture = null) {
		const buffer = this._ensureVertexBuffer(name, data, count, components);
		if (!buffer) return;
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, this._createGeometryBindGroup(pipeline, uniform, texture));
		pass.setVertexBuffer(0, buffer);
		pass.draw(count);
	}
	_drawGeometry(pass, uniform, transparentOverlay, scales = {}) {
		this._writeGeometryUniform(uniform, transparentOverlay, scales);
		this._drawBatch(pass, this.pipelines.disk, uniform, "disk", this.sceneDiskVertexData, this.sceneDiskVertexCount, COMPONENTS_PER_DISK_VERTEX, this.textures.circle);
		this._drawBatch(pass, transparentOverlay ? this.pipelines.trailOverlay : this.pipelines.trailScene, uniform, "trail", this.trailVertexData, this.trailVertexCount, COMPONENTS_PER_TEXTURED_VERTEX, this.textures.trail);
		this._drawBatch(pass, transparentOverlay ? this.pipelines.genericOverlay : this.pipelines.genericScene, uniform, "generic", this.vertexData, this.vertexCount, COMPONENTS_PER_VERTEX);
		this._drawBatch(pass, transparentOverlay ? this.pipelines.triangleOverlay : this.pipelines.triangleScene, uniform, "triangle", this.triangleVertexData, this.triangleVertexCount, COMPONENTS_PER_TEXTURED_VERTEX, transparentOverlay ? this.textures.triangleOverlay : this.textures.triangle);
		this._drawBatch(pass, transparentOverlay ? this.pipelines.ringOverlay : this.pipelines.ringScene, uniform, "ring", this.ringVertexData, this.ringVertexCount, COMPONENTS_PER_RING_VERTEX, this.textures.ring);
	}
	_createFullscreenBindGroup(pipeline, uniform, source0, source1 = null, source2 = null, source3 = null) {
		const entries = [{
			binding: 1,
			resource: this.sampler
		}];
		const sources = [
			source0,
			source1,
			source2,
			source3
		];
		if (uniform) entries.unshift({
			binding: 0,
			resource: { buffer: uniform }
		});
		for (let index = 0; index < sources.length; index++) {
			if (!sources[index]) break;
			entries.push({
				binding: index + 2,
				resource: sources[index]
			});
		}
		return this.device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries
		});
	}
	_drawFullscreen(encoder, pipeline, targetView, uniform, sources, label) {
		const pass = encoder.beginRenderPass({
			label,
			colorAttachments: [{
				view: targetView,
				loadOp: "clear",
				storeOp: "store",
				clearValue: {
					r: 0,
					g: 0,
					b: 0,
					a: 0
				}
			}]
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, this._createFullscreenBindGroup(pipeline, uniform, ...sources));
		pass.draw(3);
		pass.end();
	}
	_drawBackground(pass) {
		if (!this.sceneBackgroundView) return false;
		const [scaleX, scaleY] = this._getBackgroundUvScale();
		const uniforms = this._createPassUniform({
			backgroundScaleX: scaleX,
			backgroundScaleY: scaleY
		});
		this.device.queue.writeBuffer(this.backgroundUniform, 0, uniforms);
		pass.setPipeline(this.pipelines.background);
		pass.setBindGroup(0, this._createFullscreenBindGroup(this.pipelines.background, this.backgroundUniform, this.sceneBackgroundView));
		pass.draw(3);
		return true;
	}
	_renderGeometryTarget(encoder, target, uniform, settings, scales = {}) {
		const pass = encoder.beginRenderPass({
			label: "BA Click FX WebGPU scene",
			colorAttachments: [{
				view: target.view,
				loadOp: "clear",
				storeOp: "store",
				clearValue: {
					r: 0,
					g: 0,
					b: 0,
					a: 0
				}
			}]
		});
		const hasBackground = this._drawBackground(pass);
		this._drawGeometry(pass, uniform, settings.outputCompositing === "browser-overlay", scales);
		pass.end();
		return hasBackground;
	}
	_deleteTargets() {
		destroyTexture(this.sourceTarget);
		destroyTexture(this.bloomSourceTarget);
		destroyTexture(this.sceneOverlayTarget);
		for (const level of this.levels) {
			destroyTexture(level.down);
			destroyTexture(level.up);
			level.downUniform?.destroy?.();
			level.upUniform?.destroy?.();
		}
		this.sourceTarget = null;
		this.bloomSourceTarget = null;
		this.sceneOverlayTarget = null;
		this.levels = [];
	}
	_allocateTargets() {
		try {
			this._deleteTargets();
			this.sourceTarget = createTarget(this.device, this.sourceWidth, this.sourceHeight, "BA Click FX WebGPU scene target");
			this.sceneOverlayTarget = createTarget(this.device, this.sourceWidth, this.sourceHeight, "BA Click FX WebGPU scene overlay");
			let width = this.width;
			let height = this.height;
			const pyramid = calculatePyramidSettings(this.sourceWidth, this.sourceHeight, this.resolutionScale, this.diffusion);
			this.sampleScale = pyramid.sampleScale;
			for (let index = 0; index < pyramid.levelCount; index++) {
				const level = {
					width,
					height,
					down: createTarget(this.device, width, height, `BA Click FX WebGPU bloom down ${index}`),
					up: index === pyramid.levelCount - 1 ? null : createTarget(this.device, width, height, `BA Click FX WebGPU bloom up ${index}`),
					downUniform: this._createUniformBuffer(`BA Click FX WebGPU down uniforms ${index}`, PASS_UNIFORM_SIZE),
					upUniform: this._createUniformBuffer(`BA Click FX WebGPU up uniforms ${index}`, PASS_UNIFORM_SIZE)
				};
				this.levels.push(level);
				if (width === 1 && height === 1) break;
				width = Math.max(1, width >> 1);
				height = Math.max(1, height >> 1);
			}
			this.stats.levelCount = this.levels.length;
			this.stats.bloomPixels = this.levels.reduce((sum, level) => sum + level.width * level.height, 0);
			return this.levels.length > 0;
		} catch (error) {
			console.warn("[BAClickFX] WebGPU Scene 缓冲创建失败:", error);
			this._deleteTargets();
			return false;
		}
	}
	_ensureFinalPipeline() {
		const format = this.deviceManager.canvasFormat;
		if (this.finalPipeline && this.finalPipelineFormat === format) return true;
		this.finalPipeline = this._createFullscreenPipeline("fragmentFinal", format);
		this.finalPipelineFormat = format;
		return true;
	}
	resize(displayWidth, displayHeight, dpr, resolutionScale, diffusion) {
		if (!this.available || this.contextLost) return false;
		const safeDisplayWidth = Math.max(1, displayWidth);
		const safeDisplayHeight = Math.max(1, displayHeight);
		const safeDpr = clamp$2(dpr, 1, 4);
		const safeScale = clamp$2(resolutionScale, .1, .75);
		const sourceWidth = Math.max(1, Math.round(safeDisplayWidth * safeDpr));
		const sourceHeight = Math.max(1, Math.round(safeDisplayHeight * safeDpr));
		const width = Math.max(1, Math.floor(sourceWidth * safeScale));
		const height = Math.max(1, Math.floor(sourceHeight * safeScale));
		const safeDiffusion = clamp$2(diffusion, 0, 10);
		if (sourceWidth > this.maximumTextureSize || sourceHeight > this.maximumTextureSize) return false;
		const unchanged = sourceWidth === this.sourceWidth && sourceHeight === this.sourceHeight && width === this.width && height === this.height && safeDiffusion === this.diffusion && this.sourceTarget !== null && this.levels.length > 0;
		this.displayWidth = safeDisplayWidth;
		this.displayHeight = safeDisplayHeight;
		this.dpr = safeDpr;
		this.resolutionScale = safeScale;
		this.diffusion = safeDiffusion;
		this.sourceWidth = sourceWidth;
		this.sourceHeight = sourceHeight;
		this.width = width;
		this.height = height;
		if (this.canvas.width !== sourceWidth || this.canvas.height !== sourceHeight) {
			this.canvas.width = sourceWidth;
			this.canvas.height = sourceHeight;
		}
		if (!this.deviceManager.configure({ preferHdr: this.preferHdr })) return false;
		this._ensureFinalPipeline();
		return unchanged || this._allocateTargets();
	}
	_uploadSceneBackground() {
		if (!this.available || !this.device || !this.sceneBackgroundSource || this.sceneBackgroundWidth <= 0 || this.sceneBackgroundHeight <= 0) return false;
		let texture = null;
		try {
			texture = this.device.createTexture({
				label: "BA Click FX WebGPU compositing reference",
				size: {
					width: this.sceneBackgroundWidth,
					height: this.sceneBackgroundHeight
				},
				format: "rgba8unorm-srgb",
				usage: TEXTURE_USAGE.COPY_DST | TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.RENDER_ATTACHMENT
			});
			this.device.queue.copyExternalImageToTexture({ source: this.sceneBackgroundSource }, { texture }, {
				width: this.sceneBackgroundWidth,
				height: this.sceneBackgroundHeight
			});
			this.sceneBackgroundTexture?.destroy?.();
			this.sceneBackgroundTexture = texture;
			this.sceneBackgroundView = texture.createView();
			return true;
		} catch (error) {
			texture?.destroy?.();
			console.warn("[BAClickFX] WebGPU 合成参考上传失败:", error);
			return false;
		}
	}
	setCompositingReference(source, options = {}) {
		if (source === null) {
			this.sceneBackgroundTexture?.destroy?.();
			this.sceneBackgroundTexture = null;
			this.sceneBackgroundView = null;
			this.sceneBackgroundSource = null;
			this.sceneBackgroundWidth = 0;
			this.sceneBackgroundHeight = 0;
			return true;
		}
		if (options.fit !== void 0 && options.fit !== "cover") return false;
		const dimensions = getTexImageSourceDimensions(source);
		if (!dimensions) return false;
		const previous = {
			source: this.sceneBackgroundSource,
			width: this.sceneBackgroundWidth,
			height: this.sceneBackgroundHeight
		};
		this.sceneBackgroundSource = source;
		this.sceneBackgroundWidth = dimensions.width;
		this.sceneBackgroundHeight = dimensions.height;
		if (!this.available || this._uploadSceneBackground()) return true;
		this.sceneBackgroundSource = previous.source;
		this.sceneBackgroundWidth = previous.width;
		this.sceneBackgroundHeight = previous.height;
		return false;
	}
	_ensureBloomSourceTarget() {
		if (this.bloomSourceTarget?.width === this.sourceWidth && this.bloomSourceTarget?.height === this.sourceHeight) return true;
		destroyTexture(this.bloomSourceTarget);
		this.bloomSourceTarget = createTarget(this.device, this.sourceWidth, this.sourceHeight, "BA Click FX WebGPU scaled bloom source");
		return true;
	}
	renderScene(settings = {}) {
		if (!this.available || this.contextLost || !this.sourceTarget) return false;
		try {
			const encoder = this.device.createCommandEncoder({ label: "BA Click FX WebGPU scene commands" });
			this.sceneBackgroundFrameReady = this._renderGeometryTarget(encoder, this.sourceTarget, this.geometryUniform, settings);
			const disk = Math.max(0, settings.diskEmissionScale ?? 1);
			const ring = Math.max(0, settings.ringEmissionScale ?? 1);
			this.bloomSourceFrameReady = false;
			if (disk !== 1 || ring !== 1) {
				this._ensureBloomSourceTarget();
				this._renderGeometryTarget(encoder, this.bloomSourceTarget, this.bloomGeometryUniform, settings, {
					disk,
					ring
				});
				this.bloomSourceFrameReady = true;
			} else {
				destroyTexture(this.bloomSourceTarget);
				this.bloomSourceTarget = null;
			}
			this.sceneOverlayFrameReady = false;
			if (settings.outputCompositing === "browser-overlay" && !isIndependentHostCompositing(settings.hostCompositing)) {
				this._drawFullscreen(encoder, this.pipelines.sceneOverlay, this.sceneOverlayTarget.view, null, [this.sourceTarget.view], "BA Click FX WebGPU scene coverage");
				this.sceneOverlayFrameReady = true;
			}
			this.device.queue.submit([encoder.finish()]);
			this.sceneFrameReady = true;
			this.stats.sceneVertexCount = this.vertexCount + this.triangleVertexCount + this.trailVertexCount;
			this.stats.sceneDiskVertexCount = this.sceneDiskVertexCount;
			this.stats.sceneRingVertexCount = this.ringVertexCount;
			this.stats.sceneTriangleVertexCount = this.triangleVertexCount;
			this.stats.sceneTrailVertexCount = this.trailVertexCount;
			return true;
		} catch (error) {
			console.warn("[BAClickFX] WebGPU 清晰特效渲染失败:", error);
			this.available = false;
			this._setRendererStatus("unavailable", error);
			return false;
		}
	}
	_renderBloomPasses(encoder, settings) {
		const bloomSource = this.bloomSourceFrameReady ? this.bloomSourceTarget : this.sourceTarget;
		const first = this.levels[0];
		const prefilterData = this._createPassUniform({
			texelX: 1 / this.sourceWidth,
			texelY: 1 / this.sourceHeight,
			threshold: gammaToLinear(settings.threshold),
			softKnee: clamp$2(settings.softKnee ?? 0, 0, 1),
			clampMax: resolveUnityBloomClamp(settings.clamp)
		});
		this.device.queue.writeBuffer(this.prefilterUniform, 0, prefilterData);
		this._drawFullscreen(encoder, this.pipelines.prefilter, first.down.view, this.prefilterUniform, [bloomSource.view], "BA Click FX WebGPU bloom prefilter");
		for (let index = 1; index < this.levels.length; index++) {
			const previous = this.levels[index - 1];
			const level = this.levels[index];
			const uniforms = this._createPassUniform({
				texelX: 1 / previous.width,
				texelY: 1 / previous.height
			});
			this.device.queue.writeBuffer(level.downUniform, 0, uniforms);
			this._drawFullscreen(encoder, this.pipelines.downsample, level.down.view, level.downUniform, [previous.down.view], `BA Click FX WebGPU bloom downsample ${index}`);
		}
		let accumulated = this.levels.at(-1).down;
		for (let index = this.levels.length - 2; index >= 0; index--) {
			const fine = this.levels[index];
			const coarse = this.levels[index + 1];
			const uniforms = this._createPassUniform({
				texelX: 1 / coarse.width,
				texelY: 1 / coarse.height,
				sampleScale: this.sampleScale
			});
			this.device.queue.writeBuffer(fine.upUniform, 0, uniforms);
			this._drawFullscreen(encoder, this.pipelines.upsample, fine.up.view, fine.upUniform, [accumulated.view, fine.down.view], `BA Click FX WebGPU bloom upsample ${index}`);
			accumulated = fine.up;
		}
		return accumulated;
	}
	render(settings, options = {}) {
		if (!this.available || this.contextLost || !this.sourceTarget || this.levels.length === 0 || !this.finalPipeline) return false;
		try {
			const hasScene = options.preserveCanvas === true && this.sceneFrameReady;
			const encoder = this.device.createCommandEncoder({ label: "BA Click FX WebGPU bloom commands" });
			const bloom = this._renderBloomPasses(encoder, settings);
			const [backgroundScaleX, backgroundScaleY] = this._getBackgroundUvScale();
			const hasBackground = hasScene && this.sceneBackgroundFrameReady;
			const useSceneOverlay = hasScene && !hasBackground && settings.outputCompositing === "browser-overlay" && !isIndependentHostCompositing(settings.hostCompositing) && this.sceneOverlayFrameReady;
			const uniforms = this._createPassUniform({
				texelX: 1 / bloom.width,
				texelY: 1 / bloom.height,
				backgroundScaleX,
				backgroundScaleY,
				sampleScale: this.sampleScale,
				intensity: resolveUnityBloomIntensity(settings.intensity),
				overlayAlphaLimit: clamp$2(settings.overlayAlphaLimit ?? 1, 0, 1),
				opacity: clamp$2(settings.opacity ?? 1, 0, 1),
				hasScene,
				hasBackground,
				transparentOverlay: settings.outputCompositing === "browser-overlay",
				visualMaxAlpha: settings.overlayAlphaPolicy === "visual-max",
				brightUnknownBackground: settings.overlayColorCompensation === "bright-core",
				hostAdditive: isIndependentHostCompositing(settings.hostCompositing),
				extendedOutput: this.hdrOutput,
				hdrPeak: settings.webgpuHdrPeak,
				hdrBrightness: settings.webgpuHdrBrightness,
				hdrColorPreservation: settings.webgpuHdrColorPreservation,
				hdrWhiteCore: settings.webgpuHdrWhiteCore,
				hdrWhiteStart: settings.webgpuHdrWhiteStart,
				hdrWhiteEnd: settings.webgpuHdrWhiteEnd
			});
			this.device.queue.writeBuffer(this.finalUniform, 0, uniforms);
			this._drawFullscreen(encoder, this.finalPipeline, this.context.getCurrentTexture().createView(), this.finalUniform, [
				bloom.view,
				hasScene ? useSceneOverlay ? this.sceneOverlayTarget.view : this.sourceTarget.view : this.placeholderView,
				hasScene ? this.sourceTarget.view : this.placeholderView,
				hasBackground ? this.sceneBackgroundView : this.placeholderView
			], "BA Click FX WebGPU final");
			this.device.queue.submit([encoder.finish()]);
			this.stats.vertexCount = this.vertexCount + this.triangleVertexCount + this.trailVertexCount;
			this.stats.diskVertexCount = this.sceneDiskVertexCount;
			this.stats.ringVertexCount = this.ringVertexCount;
			this.stats.triangleVertexCount = this.triangleVertexCount;
			this.stats.trailVertexCount = this.trailVertexCount;
			return true;
		} catch (error) {
			console.warn("[BAClickFX] WebGPU Scene 渲染失败:", error);
			this.available = false;
			this._setRendererStatus("unavailable", error);
			return false;
		}
	}
	clear() {
		this.sceneFrameReady = false;
		this.bloomSourceFrameReady = false;
		this.sceneOverlayFrameReady = false;
		this.sceneBackgroundFrameReady = false;
		if (!this.available || !this.finalPipeline || this.deviceManager.outputMode === "unconfigured") return;
		try {
			const encoder = this.device.createCommandEncoder();
			encoder.beginRenderPass({ colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				loadOp: "clear",
				storeOp: "store",
				clearValue: {
					r: 0,
					g: 0,
					b: 0,
					a: 0
				}
			}] }).end();
			this.device.queue.submit([encoder.finish()]);
		} catch {}
	}
	suspendPresentation() {
		this.sceneFrameReady = false;
		this.bloomSourceFrameReady = false;
		this.sceneOverlayFrameReady = false;
		this.sceneBackgroundFrameReady = false;
		return this.deviceManager.unconfigure();
	}
	releaseFrameResources() {
		const suspended = this.suspendPresentation();
		this._deleteTargets();
		this.beginFrame();
		return suspended;
	}
	destroy() {
		if (this.status === "destroyed") return;
		this._setRendererStatus("destroyed");
		this._deleteTargets();
		for (const entry of Object.values(this.vertexBuffers)) entry.buffer?.destroy?.();
		for (const texture of Object.values(this.textures)) texture?.destroy?.();
		this.placeholderTexture?.destroy?.();
		this.sceneBackgroundTexture?.destroy?.();
		this.geometryUniform?.destroy?.();
		this.bloomGeometryUniform?.destroy?.();
		this.backgroundUniform?.destroy?.();
		this.prefilterUniform?.destroy?.();
		this.finalUniform?.destroy?.();
		this.deviceManager.destroy();
		this.available = false;
		this.contextLost = false;
		this.vertexCount = 0;
		this.sceneDiskVertexCount = 0;
		this.ringVertexCount = 0;
		this.triangleVertexCount = 0;
		this.trailVertexCount = 0;
	}
};
//#endregion
//#region src/webgl2-canvas-scene.js
const COVERAGE_VERTEX_COMPONENTS = 5;
const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 v_uv;

void main()
{
  vec2 positions[3] = vec2[](
    vec2(-1.0, -1.0),
    vec2(3.0, -1.0),
    vec2(-1.0, 3.0)
  );
  vec2 position = positions[gl_VertexID];

  gl_Position = vec4(position, 0.0, 1.0);
  v_uv = position * 0.5 + 0.5;
}
`;
const COVERAGE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in float a_particleAlpha;

uniform vec2 u_displaySize;

out vec2 v_uv;
out float v_particleAlpha;

void main()
{
  vec2 normalized = a_position / u_displaySize;

  gl_Position = vec4(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0
  );
  v_uv = a_uv;
  v_particleAlpha = a_particleAlpha;
}
`;
const COVERAGE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_circle;

in vec2 v_uv;
in float v_particleAlpha;
out vec4 outColor;

void main()
{
  // Circle_01 以 sRGB 导入；SRGB8_ALPHA8 在采样时恢复 Shader 读取的线性 R。
  float coverage = texture(u_circle, v_uv).r *
    clamp(v_particleAlpha, 0.0, 1.0);

  outColor = vec4(coverage, 0.0, 0.0, coverage);
}
`;
const FINAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_effect;
uniform sampler2D u_coverage;
uniform sampler2D u_background;
uniform vec2 u_backgroundUvScale;

in vec2 v_uv;
out vec4 outColor;

float linearToSrgb(float value)
{
  float linear = clamp(value, 0.0, 1.0);

  if (linear <= 0.0031308)
  {
    return linear * 12.92;
  }

  return 1.055 * pow(linear, 1.0 / 2.4) - 0.055;
}

float solveOverlayAlpha(float background, float target)
{
  if (target > background)
  {
    return (target - background) / max(1.0 - background, 0.000001);
  }

  if (target < background)
  {
    return (background - target) / max(background, 0.000001);
  }

  return 0.0;
}

void main()
{
  // DOM Canvas 上传保持顶行原点，所有浏览器统一在 Shader 中翻转。
  vec2 canvasUv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec3 effectLinear = texture(u_effect, canvasUv).rgb;
  float coverage = clamp(texture(u_coverage, v_uv).r, 0.0, 1.0);
  vec2 backgroundUv = (v_uv - 0.5) * u_backgroundUvScale + 0.5;

  backgroundUv.y = 1.0 - backgroundUv.y;

  vec3 backgroundLinear = texture(u_background, backgroundUv).rgb;
  vec3 linear = effectLinear + backgroundLinear * (1.0 - coverage);
  vec3 targetSrgb = vec3(
    linearToSrgb(linear.r),
    linearToSrgb(linear.g),
    linearToSrgb(linear.b)
  );
  vec3 backgroundSrgb = vec3(
    linearToSrgb(backgroundLinear.r),
    linearToSrgb(backgroundLinear.g),
    linearToSrgb(backgroundLinear.b)
  );
  vec3 difference = abs(targetSrgb - backgroundSrgb);

  if (max(max(difference.r, difference.g), difference.b) <= 0.00001)
  {
    outColor = vec4(0.0);
    return;
  }

  vec3 channelAlpha = vec3(
    solveOverlayAlpha(backgroundSrgb.r, targetSrgb.r),
    solveOverlayAlpha(backgroundSrgb.g, targetSrgb.g),
    solveOverlayAlpha(backgroundSrgb.b, targetSrgb.b)
  );
  float overlayAlpha = clamp(
    max(max(channelAlpha.r, channelAlpha.g), channelAlpha.b),
    0.0,
    1.0
  );
  vec3 premultiplied = targetSrgb -
    backgroundSrgb * (1.0 - overlayAlpha);

  outColor = vec4(
    clamp(premultiplied, vec3(0.0), vec3(overlayAlpha)),
    overlayAlpha
  );
}
`;
function clamp$1(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}
function getRasterSourceDimensions(source) {
	if (!source) return null;
	let width;
	let height;
	try {
		width = source.naturalWidth ?? source.videoWidth ?? source.displayWidth ?? source.width;
		height = source.naturalHeight ?? source.videoHeight ?? source.displayHeight ?? source.height;
	} catch {
		return null;
	}
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	return {
		width,
		height
	};
}
function compileShader(gl, type, source) {
	const shader = gl.createShader(type);
	if (!shader) throw new Error("Canvas Scene Final Pass 无法创建 Shader");
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader) || "未知编译错误";
		gl.deleteShader(shader);
		throw new Error(message);
	}
	return shader;
}
function createProgram(gl, vertexSource, fragmentSource) {
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
	const program = gl.createProgram();
	if (!program) {
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
		throw new Error("Canvas Scene Final Pass 无法创建 Program");
	}
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) || "未知链接错误";
		gl.deleteProgram(program);
		throw new Error(message);
	}
	return program;
}
function configureTexture(gl, texture, filter) {
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
var WebGL2CanvasSceneRenderer = class {
	constructor(canvas) {
		this.canvas = canvas;
		this.gl = null;
		this.available = false;
		this.contextLost = false;
		this.destroyed = false;
		this.displayWidth = 1;
		this.displayHeight = 1;
		this.dpr = 1;
		this.width = 0;
		this.height = 0;
		this.maximumTextureSize = 0;
		this.maximumViewportWidth = 0;
		this.maximumViewportHeight = 0;
		this.failedResizeSignature = null;
		this.finalProgram = null;
		this.coverageProgram = null;
		this.fullscreenVao = null;
		this.coverageVao = null;
		this.coverageBuffer = null;
		this.effectTexture = null;
		this.coverageTexture = null;
		this.coverageFramebuffer = null;
		this.circleTexture = null;
		this.backgroundTexture = null;
		this.backgroundSource = null;
		this.backgroundWidth = 0;
		this.backgroundHeight = 0;
		this.backgroundUploadRetryPending = false;
		this.coverageVertexCount = 0;
		this.coverageVertexData = /* @__PURE__ */ new Float32Array(240);
		this._onContextLost = this._handleContextLost.bind(this);
		this._onContextRestored = this._handleContextRestored.bind(this);
		this.canvas?.addEventListener?.("webglcontextlost", this._onContextLost);
		this.canvas?.addEventListener?.("webglcontextrestored", this._onContextRestored);
		this._initialize();
	}
	get hasSceneBackground() {
		return this.backgroundTexture !== null;
	}
	_discardPendingErrors() {
		const gl = this.gl;
		if (!gl) return;
		for (let count = 0; count < 8; count++) if (gl.getError() === gl.NO_ERROR) return;
	}
	_initialize() {
		if (this.destroyed) return;
		try {
			const gl = this.canvas?.getContext?.("webgl2", {
				alpha: true,
				antialias: false,
				depth: false,
				stencil: false,
				premultipliedAlpha: true,
				preserveDrawingBuffer: false,
				powerPreference: "high-performance"
			});
			if (!gl) {
				this.available = false;
				return;
			}
			this.gl = gl;
			this.failedResizeSignature = null;
			this.maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
			const maximumViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
			this.maximumViewportWidth = maximumViewport?.[0] ?? this.maximumTextureSize;
			this.maximumViewportHeight = maximumViewport?.[1] ?? this.maximumTextureSize;
			this.finalProgram = createProgram(gl, FULLSCREEN_VERTEX_SHADER, FINAL_FRAGMENT_SHADER);
			this.coverageProgram = createProgram(gl, COVERAGE_VERTEX_SHADER, COVERAGE_FRAGMENT_SHADER);
			this.fullscreenVao = gl.createVertexArray();
			this.coverageVao = gl.createVertexArray();
			this.coverageBuffer = gl.createBuffer();
			this.circleTexture = gl.createTexture();
			if (!this.fullscreenVao || !this.coverageVao || !this.coverageBuffer || !this.circleTexture) throw new Error("Canvas Scene Final Pass 资源分配失败");
			gl.bindVertexArray(this.coverageVao);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.coverageBuffer);
			const stride = COVERAGE_VERTEX_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
			gl.enableVertexAttribArray(0);
			gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
			gl.enableVertexAttribArray(1);
			gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
			gl.enableVertexAttribArray(2);
			gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 4 * Float32Array.BYTES_PER_ELEMENT);
			gl.bindVertexArray(null);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);
			configureTexture(gl, this.circleTexture, gl.LINEAR);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, CIRCLE_TEXTURE_RGBA);
			gl.bindTexture(gl.TEXTURE_2D, null);
			this.contextLost = false;
			this.available = true;
			const requestedWidth = this.width;
			const requestedHeight = this.height;
			this.width = 0;
			this.height = 0;
			if (requestedWidth > 0 && requestedHeight > 0) this._allocateFrameResources(requestedWidth, requestedHeight);
			if (this.backgroundSource) this.backgroundUploadRetryPending = !this._replaceBackgroundTexture(this.backgroundSource);
		} catch (error) {
			console.warn("[BAClickFX] Canvas Scene Final Pass 初始化失败:", error);
			this.available = false;
			this._deleteResources();
		}
	}
	_deleteFrameResources() {
		const gl = this.gl;
		if (gl && !this.contextLost) {
			gl.deleteTexture(this.effectTexture);
			gl.deleteTexture(this.coverageTexture);
			gl.deleteFramebuffer(this.coverageFramebuffer);
		}
		this.effectTexture = null;
		this.coverageTexture = null;
		this.coverageFramebuffer = null;
	}
	releaseFrameResources() {
		this._deleteFrameResources();
		this.beginFrame();
		this.displayWidth = 1;
		this.displayHeight = 1;
		this.dpr = 1;
		this.width = 0;
		this.height = 0;
		this.failedResizeSignature = null;
		if (this.canvas && (this.canvas.width !== 1 || this.canvas.height !== 1)) {
			this.canvas.width = 1;
			this.canvas.height = 1;
		}
	}
	_deleteResources() {
		const gl = this.gl;
		this._deleteFrameResources();
		if (gl && !this.contextLost) {
			gl.deleteProgram(this.finalProgram);
			gl.deleteProgram(this.coverageProgram);
			gl.deleteVertexArray(this.fullscreenVao);
			gl.deleteVertexArray(this.coverageVao);
			gl.deleteBuffer(this.coverageBuffer);
			gl.deleteTexture(this.circleTexture);
			gl.deleteTexture(this.backgroundTexture);
		}
		this.finalProgram = null;
		this.coverageProgram = null;
		this.fullscreenVao = null;
		this.coverageVao = null;
		this.coverageBuffer = null;
		this.circleTexture = null;
		this.backgroundTexture = null;
	}
	_createFrameResources(width, height) {
		const gl = this.gl;
		const effectTexture = gl.createTexture();
		const coverageTexture = gl.createTexture();
		const coverageFramebuffer = gl.createFramebuffer();
		if (!effectTexture || !coverageTexture || !coverageFramebuffer) {
			gl.deleteTexture(effectTexture);
			gl.deleteTexture(coverageTexture);
			gl.deleteFramebuffer(coverageFramebuffer);
			return null;
		}
		try {
			this._discardPendingErrors();
			configureTexture(gl, effectTexture, gl.NEAREST);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
			configureTexture(gl, coverageTexture, gl.NEAREST);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
			gl.bindFramebuffer(gl.FRAMEBUFFER, coverageFramebuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, coverageTexture, 0);
			const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
			const error = gl.getError();
			if (status !== gl.FRAMEBUFFER_COMPLETE || error !== gl.NO_ERROR) throw new Error(`Coverage FBO 状态 ${status}，错误码 ${error}`);
			return {
				effectTexture,
				coverageTexture,
				coverageFramebuffer
			};
		} catch (error) {
			console.warn("[BAClickFX] Canvas Scene 帧资源分配失败:", error);
			gl.deleteTexture(effectTexture);
			gl.deleteTexture(coverageTexture);
			gl.deleteFramebuffer(coverageFramebuffer);
			return null;
		} finally {
			gl.bindTexture(gl.TEXTURE_2D, null);
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		}
	}
	_allocateFrameResources(width, height) {
		const resources = this._createFrameResources(width, height);
		if (!resources) return false;
		this._deleteFrameResources();
		this.effectTexture = resources.effectTexture;
		this.coverageTexture = resources.coverageTexture;
		this.coverageFramebuffer = resources.coverageFramebuffer;
		this.width = width;
		this.height = height;
		return true;
	}
	resize(displayWidth, displayHeight, dpr) {
		if (!this.available || !this.gl || this.contextLost) return false;
		const safeDisplayWidth = Math.max(1, displayWidth);
		const safeDisplayHeight = Math.max(1, displayHeight);
		const safeDpr = clamp$1(dpr, 1, 4);
		const width = Math.max(1, Math.round(safeDisplayWidth * safeDpr));
		const height = Math.max(1, Math.round(safeDisplayHeight * safeDpr));
		const signature = `${width}:${height}`;
		this.displayWidth = safeDisplayWidth;
		this.displayHeight = safeDisplayHeight;
		this.dpr = safeDpr;
		if (signature === this.failedResizeSignature) return false;
		if (width > this.maximumTextureSize || height > this.maximumTextureSize || width > this.maximumViewportWidth || height > this.maximumViewportHeight) {
			this.failedResizeSignature = signature;
			return false;
		}
		if (this.backgroundUploadRetryPending) {
			this.backgroundUploadRetryPending = false;
			if (!this._replaceBackgroundTexture(this.backgroundSource)) return false;
		}
		if (width === this.width && height === this.height && this.effectTexture && this.coverageTexture && this.coverageFramebuffer) {
			this.failedResizeSignature = null;
			return true;
		}
		if (!this._allocateFrameResources(width, height)) {
			this.failedResizeSignature = signature;
			return false;
		}
		this.canvas.width = width;
		this.canvas.height = height;
		this.failedResizeSignature = null;
		return true;
	}
	_createBackgroundTexture(source) {
		const gl = this.gl;
		const texture = gl?.createTexture();
		if (!gl || !texture) return null;
		const previousFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
		const previousPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
		const previousColorConversion = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);
		try {
			this._discardPendingErrors();
			configureTexture(gl, texture, gl.LINEAR);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
			gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
			const error = gl.getError();
			if (error !== gl.NO_ERROR) throw new Error(`背景纹理上传错误码 ${error}`);
			return texture;
		} catch (error) {
			console.warn("[BAClickFX] Canvas Scene 背景上传失败:", error);
			gl.deleteTexture(texture);
			return null;
		} finally {
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previousFlipY);
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, previousPremultiply);
			gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, previousColorConversion);
			gl.bindTexture(gl.TEXTURE_2D, null);
		}
	}
	_replaceBackgroundTexture(source) {
		const dimensions = getRasterSourceDimensions(source);
		if (!dimensions || !this.gl || this.contextLost) return false;
		const texture = this._createBackgroundTexture(source);
		if (!texture) return false;
		this.gl.deleteTexture(this.backgroundTexture);
		this.backgroundTexture = texture;
		this.backgroundSource = source;
		this.backgroundWidth = dimensions.width;
		this.backgroundHeight = dimensions.height;
		this.backgroundUploadRetryPending = false;
		this.failedResizeSignature = null;
		return true;
	}
	setCompositingReference(source, options = {}) {
		if (options.fit !== void 0 && options.fit !== "cover") return false;
		if (source === null) {
			this.gl?.deleteTexture(this.backgroundTexture);
			this.backgroundTexture = null;
			this.backgroundSource = null;
			this.backgroundWidth = 0;
			this.backgroundHeight = 0;
			this.backgroundUploadRetryPending = false;
			this.failedResizeSignature = null;
			return true;
		}
		const dimensions = getRasterSourceDimensions(source);
		if (!dimensions) return false;
		if (this.contextLost || !this.gl) {
			this.backgroundSource = source;
			this.backgroundWidth = dimensions.width;
			this.backgroundHeight = dimensions.height;
			this.backgroundUploadRetryPending = true;
			return true;
		}
		return this._replaceBackgroundTexture(source);
	}
	beginFrame() {
		this.coverageVertexCount = 0;
	}
	_ensureCoverageVertexCapacity(additionalVertices) {
		const required = (this.coverageVertexCount + additionalVertices) * COVERAGE_VERTEX_COMPONENTS;
		if (required <= this.coverageVertexData.length) return;
		let nextLength = this.coverageVertexData.length;
		while (nextLength < required) nextLength = Math.ceil(nextLength * 1.5);
		const next = new Float32Array(nextLength);
		next.set(this.coverageVertexData.subarray(0, this.coverageVertexCount * COVERAGE_VERTEX_COMPONENTS));
		this.coverageVertexData = next;
	}
	_appendCoverageVertex(x, y, u, v, alpha) {
		const offset = this.coverageVertexCount * COVERAGE_VERTEX_COMPONENTS;
		this.coverageVertexData[offset] = x;
		this.coverageVertexData[offset + 1] = y;
		this.coverageVertexData[offset + 2] = u;
		this.coverageVertexData[offset + 3] = v;
		this.coverageVertexData[offset + 4] = clamp$1(alpha, 0, 1);
		this.coverageVertexCount++;
	}
	addCoverageDisk(x, y, radius, alpha, rotation = 0) {
		if (radius <= 0 || alpha <= 0) return;
		const angle = Number.isFinite(rotation) ? rotation : 0;
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		const appendCorner = (localX, localY, u, v) => {
			this._appendCoverageVertex(x + localX * cosine - localY * sine, y + localX * sine + localY * cosine, u, v, alpha);
		};
		this._ensureCoverageVertexCapacity(6);
		appendCorner(-radius, -radius, 0, 0);
		appendCorner(radius, -radius, 1, 0);
		appendCorner(radius, radius, 1, 1);
		appendCorner(-radius, -radius, 0, 0);
		appendCorner(radius, radius, 1, 1);
		appendCorner(-radius, radius, 0, 1);
	}
	_uploadEffectCanvas(effectCanvas) {
		const gl = this.gl;
		const previousFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
		const previousPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
		const previousColorConversion = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);
		try {
			this._discardPendingErrors();
			gl.bindTexture(gl.TEXTURE_2D, this.effectTexture);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
			gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, effectCanvas);
			return gl.getError() === gl.NO_ERROR;
		} catch {
			return false;
		} finally {
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previousFlipY);
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, previousPremultiply);
			gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, previousColorConversion);
			gl.bindTexture(gl.TEXTURE_2D, null);
		}
	}
	_drawCoverage() {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.coverageFramebuffer);
		gl.viewport(0, 0, this.width, this.height);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.CULL_FACE);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (this.coverageVertexCount === 0) return;
		gl.enable(gl.BLEND);
		gl.blendEquation(gl.FUNC_ADD);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.useProgram(this.coverageProgram);
		gl.uniform2f(gl.getUniformLocation(this.coverageProgram, "u_displaySize"), this.displayWidth, this.displayHeight);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.circleTexture);
		gl.uniform1i(gl.getUniformLocation(this.coverageProgram, "u_circle"), 0);
		gl.bindVertexArray(this.coverageVao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.coverageBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, this.coverageVertexData.subarray(0, this.coverageVertexCount * COVERAGE_VERTEX_COMPONENTS), gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.TRIANGLES, 0, this.coverageVertexCount);
	}
	_getBackgroundUvScale() {
		const sourceAspect = this.backgroundWidth / this.backgroundHeight;
		const displayAspect = this.displayWidth / this.displayHeight;
		if (sourceAspect > displayAspect) return [displayAspect / sourceAspect, 1];
		return [1, sourceAspect / displayAspect];
	}
	_drawFinal() {
		const gl = this.gl;
		const backgroundUvScale = this._getBackgroundUvScale();
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.width, this.height);
		gl.disable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.CULL_FACE);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.useProgram(this.finalProgram);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.effectTexture);
		gl.uniform1i(gl.getUniformLocation(this.finalProgram, "u_effect"), 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.coverageTexture);
		gl.uniform1i(gl.getUniformLocation(this.finalProgram, "u_coverage"), 1);
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
		gl.uniform1i(gl.getUniformLocation(this.finalProgram, "u_background"), 2);
		gl.uniform2f(gl.getUniformLocation(this.finalProgram, "u_backgroundUvScale"), backgroundUvScale[0], backgroundUvScale[1]);
		gl.bindVertexArray(this.fullscreenVao);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}
	render(effectCanvas) {
		if (!this.available || this.contextLost || !this.gl || !this.effectTexture || !this.coverageTexture || !this.coverageFramebuffer || !this.backgroundTexture || effectCanvas?.width !== this.width || effectCanvas?.height !== this.height) return false;
		if (!this._uploadEffectCanvas(effectCanvas)) return false;
		try {
			this._discardPendingErrors();
			this._drawCoverage();
			this._drawFinal();
			this.gl.flush();
			return this.gl.getError() === this.gl.NO_ERROR;
		} catch {
			return false;
		}
	}
	clear() {
		if (!this.gl || this.contextLost) return;
		this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
		this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		this.gl.clearColor(0, 0, 0, 0);
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}
	_handleContextLost(event) {
		event?.preventDefault?.();
		this.contextLost = true;
		this.available = false;
		this.finalProgram = null;
		this.coverageProgram = null;
		this.fullscreenVao = null;
		this.coverageVao = null;
		this.coverageBuffer = null;
		this.effectTexture = null;
		this.coverageTexture = null;
		this.coverageFramebuffer = null;
		this.circleTexture = null;
		this.backgroundTexture = null;
		this.failedResizeSignature = null;
		this.backgroundUploadRetryPending = this.backgroundSource !== null;
	}
	_handleContextRestored() {
		this.contextLost = false;
		this._initialize();
		this.failedResizeSignature = null;
	}
	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.canvas?.removeEventListener?.("webglcontextlost", this._onContextLost);
		this.canvas?.removeEventListener?.("webglcontextrestored", this._onContextRestored);
		this._deleteResources();
		this.coverageVertexData = /* @__PURE__ */ new Float32Array(0);
		this.coverageVertexCount = 0;
		this.available = false;
		this.gl = null;
		this.backgroundSource = null;
		this.backgroundWidth = 0;
		this.backgroundHeight = 0;
		this.backgroundUploadRetryPending = false;
	}
};
//#endregion
//#region src/triangle-path.js
const TAU$1 = Math.PI * 2;
function clamp01$2(value) {
	return Math.max(0, Math.min(1, Number(value) || 0));
}
function traceSharpTriangle(context, frame, size) {
	context.moveTo(frame[0][0] * size, frame[0][1] * size);
	context.lineTo(frame[1][0] * size, frame[1][1] * size);
	context.lineTo(frame[2][0] * size, frame[2][1] * size);
	context.closePath();
}
function resolveOutwardNormals(vertices) {
	const winding = vertices.reduce((area, point, index) => {
		const next = vertices[(index + 1) % vertices.length];
		return area + point[0] * next[1] - next[0] * point[1];
	}, 0) >= 0 ? 1 : -1;
	return {
		normals: vertices.map((point, index) => {
			const next = vertices[(index + 1) % vertices.length];
			const deltaX = next[0] - point[0];
			const deltaY = next[1] - point[1];
			const length = Math.max(1e-6, Math.hypot(deltaX, deltaY));
			return [winding * deltaY / length, -winding * deltaX / length];
		}),
		anticlockwise: winding < 0
	};
}
/**
* 描出“缩小三角核心 + 圆盘”的 Minkowski 和。
* 直边与圆弧共享同一法线，因此圆角不会变成圆内接三角形。
*/
function traceRoundedTrianglePath(context, frame, size, roundness) {
	const amount = clamp01$2(roundness);
	if (amount <= 0) {
		traceSharpTriangle(context, frame, size);
		return;
	}
	const radius = size * amount * .5;
	if (amount >= 1) {
		context.arc(0, 0, radius, 0, TAU$1, false);
		context.closePath();
		return;
	}
	const coreScale = size * (1 - amount);
	const vertices = frame.map((point) => [point[0] * coreScale, point[1] * coreScale]);
	const { normals, anticlockwise } = resolveOutwardNormals(vertices);
	const previousNormal = normals.at(-1);
	context.moveTo(vertices[0][0] + previousNormal[0] * radius, vertices[0][1] + previousNormal[1] * radius);
	for (let index = 0; index < vertices.length; index++) {
		const point = vertices[index];
		const before = normals[(index + normals.length - 1) % normals.length];
		const after = normals[index];
		const next = vertices[(index + 1) % vertices.length];
		context.arc(point[0], point[1], radius, Math.atan2(before[1], before[0]), Math.atan2(after[1], after[0]), anticlockwise);
		context.lineTo(next[0] + after[0] * radius, next[1] + after[1] * radius);
	}
	context.closePath();
}
//#endregion
//#region src/trail-coverage.js
const DEFAULT_PROFILE_SAMPLE_COUNT = 17;
function clamp01$1(value) {
	return Math.min(1, Math.max(0, value));
}
function lerp$1(from, to, progress) {
	return from + (to - from) * progress;
}
function smootherstep(progress) {
	const t = clamp01$1(progress);
	return t * t * t * (t * (t * 6 - 15) + 10);
}
/**
* Coverage keys describe the transparent-host transport envelope, not Unity
* Gradient Alpha. Smootherstep keeps both ends flat when old points expire.
*/
function evaluateTrailLongitudinalCoverage(keys, progress) {
	if (!Array.isArray(keys) || keys.length === 0) return 1;
	const t = clamp01$1(progress);
	if (t <= keys[0][0]) return clamp01$1(keys[0][1]);
	for (let index = 1; index < keys.length; index++) {
		const previous = keys[index - 1];
		const current = keys[index];
		if (t <= current[0]) {
			const span = current[0] - previous[0];
			const localProgress = span > 0 ? (t - previous[0]) / span : 1;
			return clamp01$1(lerp$1(previous[1], current[1], smootherstep(localProgress)));
		}
	}
	return clamp01$1(keys.at(-1)[1]);
}
function sampleTrailTextureCoverage(u, v) {
	const x = clamp01$1(u) * 511;
	const y = clamp01$1(v) * 511;
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const x1 = Math.min(511, x0 + 1);
	const y1 = Math.min(511, y0 + 1);
	const tx = x - x0;
	const ty = y - y0;
	return lerp$1(lerp$1(TRAIL_TEXTURE_COVERAGE[y0 * 512 + x0], TRAIL_TEXTURE_COVERAGE[y0 * 512 + x1], tx), lerp$1(TRAIL_TEXTURE_COVERAGE[y1 * 512 + x0], TRAIL_TEXTURE_COVERAGE[y1 * 512 + x1], tx), ty) / 255;
}
function evaluateTrailTextureCoverageProfile(progress, sampleCount = DEFAULT_PROFILE_SAMPLE_COUNT) {
	const count = Math.max(2, Math.floor(sampleCount));
	const u = 1 - clamp01$1(progress);
	const profile = new Array(count);
	for (let index = 0; index < count; index++) {
		const position = index / (count - 1);
		profile[index] = [position, sampleTrailTextureCoverage(u, 1 - position)];
	}
	return profile;
}
//#endregion
//#region src/fx.js
/**
* ba-click-fx — Blue Archive 的 UI/FX_Touch 浏览器移植。
*
* 这不是“相似风格”参数化引擎。实现直接复刻 Unity 中 FXTouch、
* ParticleSystem 和 TrailRenderer 的生命周期，只保留宿主接入所需的最小 API。
*/
const TAU = Math.PI * 2;
const LIGHT_BACKGROUND_CONTRAST_COLOR = [
	76,
	255,
	255
];
const BLOOM_BACKEND_CHANGE_EVENT = "baclickfxbackendchange";
const EFFECT_BACKEND_CHANGE_EVENT = "baclickfxeffectbackendchange";
const HOST_COMPOSITING_CHANGE_EVENT = "baclickfxhostcompositingchange";
const MAX_SCALED_TIME_DELTA_MS = Number.MAX_SAFE_INTEGER;
const MAX_TRAIL_INNER_MITER_RATIO = 4;
const MIN_TRAIL_SEGMENT_LENGTH = 1e-6;
const TOUCH_DIRECTION_THRESHOLD = 2;
const TOUCH_FILTER_CACHE_MS = 1e3;
const TOUCH_INPUT_MATCH_TOLERANCE = 2;
const TOUCH_ACTION_DIRECTIONS = Object.freeze({
	negative: "negative",
	positive: "positive"
});
function resolvePositiveFinite(value, fallback) {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}
function requestRenderFrame(callback) {
	if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
	return setTimeout(() => callback(performance.now()), 1e3 / 60);
}
function cancelRenderFrame(handle) {
	if (typeof cancelAnimationFrame === "function") {
		cancelAnimationFrame(handle);
		return;
	}
	clearTimeout(handle);
}
function shouldUseTouchInputFallback() {
	if (typeof window === "undefined") return false;
	if (typeof window.PointerEvent === "function") return false;
	return typeof window.TouchEvent === "function" || "ontouchstart" in window || Number(window.navigator?.maxTouchPoints) > 0;
}
let triangleTextureResources = null;
let triangleTextureUnavailable = false;
let circleTextureResources = null;
let circleTextureUnavailable = false;
function createTouchActionPolicy(value) {
	const raw = String(value ?? "auto").trim().toLowerCase();
	const tokens = raw ? raw.split(/\s+/) : ["auto"];
	const policy = {
		allowX: false,
		allowY: false,
		allowPinch: false,
		xDirections: /* @__PURE__ */ new Set(),
		yDirections: /* @__PURE__ */ new Set(),
		blockAll: false,
		requiresShim: true
	};
	const allowBothAxes = () => {
		policy.allowX = true;
		policy.allowY = true;
		policy.xDirections.add(TOUCH_ACTION_DIRECTIONS.negative);
		policy.xDirections.add(TOUCH_ACTION_DIRECTIONS.positive);
		policy.yDirections.add(TOUCH_ACTION_DIRECTIONS.negative);
		policy.yDirections.add(TOUCH_ACTION_DIRECTIONS.positive);
	};
	if (tokens.includes("auto") || tokens.includes("manipulation")) {
		allowBothAxes();
		policy.allowPinch = true;
		policy.requiresShim = false;
		return policy;
	}
	if (tokens.includes("none")) {
		policy.blockAll = true;
		return policy;
	}
	let recognized = false;
	for (const token of tokens) if (token === "pinch-zoom") {
		policy.allowPinch = true;
		recognized = true;
	} else if (token === "pan-x") {
		policy.allowX = true;
		policy.xDirections.add(TOUCH_ACTION_DIRECTIONS.negative);
		policy.xDirections.add(TOUCH_ACTION_DIRECTIONS.positive);
		recognized = true;
	} else if (token === "pan-y") {
		policy.allowY = true;
		policy.yDirections.add(TOUCH_ACTION_DIRECTIONS.negative);
		policy.yDirections.add(TOUCH_ACTION_DIRECTIONS.positive);
		recognized = true;
	} else if (token === "pan-left" || token === "pan-right") {
		policy.allowX = true;
		policy.xDirections.add(token === "pan-left" ? TOUCH_ACTION_DIRECTIONS.positive : TOUCH_ACTION_DIRECTIONS.negative);
		recognized = true;
	} else if (token === "pan-up" || token === "pan-down") {
		policy.allowY = true;
		policy.yDirections.add(token === "pan-up" ? TOUCH_ACTION_DIRECTIONS.positive : TOUCH_ACTION_DIRECTIONS.negative);
		recognized = true;
	} else {
		recognized = false;
		break;
	}
	if (!recognized) {
		allowBothAxes();
		policy.allowPinch = true;
		policy.requiresShim = false;
		return policy;
	}
	policy.requiresShim = policy.blockAll || !policy.allowX || !policy.allowY || !policy.allowPinch || policy.xDirections.size < 2 || policy.yDirections.size < 2;
	return policy;
}
function rgbToHsl(r, g, b) {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	const l = (max + min) / 2;
	if (d === 0) return [
		0,
		0,
		l
	];
	const s = l > .5 ? d / (2 - max - min) : d / (max + min);
	let h;
	if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	return [
		h / 6,
		s,
		l
	];
}
function hslToRgb(h, s, l) {
	const hueToRgb = (p, q, t) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	if (s === 0) return [
		l,
		l,
		l
	];
	const q = l < .5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return [
		hueToRgb(p, q, h + 1 / 3),
		hueToRgb(p, q, h),
		hueToRgb(p, q, h - 1 / 3)
	];
}
let themeHueShift = 0;
let relativeOklchTheme = null;
const BASE_BLUE = [
	76,
	167,
	255
];
const BASE_BLUE_HUE = rgbToHsl(BASE_BLUE[0] / 255, BASE_BLUE[1] / 255, BASE_BLUE[2] / 255)[0];
/** 将主题色 hex 转为 hue 偏移量，返回计算值供实例存储。 */
function computeThemeHueShift(hex) {
	if (!/^#[0-9a-f]{6}$/i.test(hex)) return 0;
	const [h, s] = rgbToHsl(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
	if (s < .02) return 0;
	return h - BASE_BLUE_HUE;
}
/**
* 对 RGB 数组应用主题色 hue 偏移；灰度色（饱和度极低）保持原样。
* @param {number[]} rgb — [r, g, b]，可能超过 0~255（HDR 中间值）
* @returns {number[]}
*/
function applyThemeHue(rgb) {
	if (themeHueShift === 0) return rgb;
	const [h, s, l] = rgbToHsl(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
	if (s < .02) return rgb;
	let newHue = h + themeHueShift;
	newHue = newHue - Math.floor(newHue);
	const [nr, ng, nb] = hslToRgb(newHue, s, l);
	return [
		Math.round(nr * 255),
		Math.round(ng * 255),
		Math.round(nb * 255)
	];
}
function applyThemeColor(rgb) {
	if (relativeOklchTheme) return applyRelativeOklchTheme(rgb, relativeOklchTheme);
	return applyThemeHue(rgb);
}
function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}
function clamp01(value) {
	return clamp(value, 0, 1);
}
function smoothstep(edge0, edge1, value) {
	const progress = clamp01((value - edge0) / (edge1 - edge0));
	return progress * progress * (3 - 2 * progress);
}
function scaleTimeDelta(elapsedMs, timeScale) {
	const scaledDeltaMs = elapsedMs * timeScale;
	return Number.isFinite(scaledDeltaMs) ? scaledDeltaMs : MAX_SCALED_TIME_DELTA_MS;
}
function boundsIntersect(left, right) {
	return left.x <= right.x + right.width && right.x <= left.x + left.width && left.y <= right.y + right.height && right.y <= left.y + left.height;
}
function mergeBloomRegion(regions, nextRegion) {
	let index = 0;
	while (index < regions.length) {
		const current = regions[index];
		if (!boundsIntersect(current, nextRegion)) {
			index++;
			continue;
		}
		const minimumX = Math.min(current.x, nextRegion.x);
		const minimumY = Math.min(current.y, nextRegion.y);
		const maximumX = Math.max(current.x + current.width, nextRegion.x + nextRegion.width);
		const maximumY = Math.max(current.y + current.height, nextRegion.y + nextRegion.height);
		nextRegion.x = minimumX;
		nextRegion.y = minimumY;
		nextRegion.width = maximumX - minimumX;
		nextRegion.height = maximumY - minimumY;
		const currentEmission = current.emissionBounds;
		const nextEmission = nextRegion.emissionBounds;
		const emissionMinimumX = Math.min(currentEmission.x, nextEmission.x);
		const emissionMinimumY = Math.min(currentEmission.y, nextEmission.y);
		const emissionMaximumX = Math.max(currentEmission.x + currentEmission.width, nextEmission.x + nextEmission.width);
		const emissionMaximumY = Math.max(currentEmission.y + currentEmission.height, nextEmission.y + nextEmission.height);
		nextEmission.x = emissionMinimumX;
		nextEmission.y = emissionMinimumY;
		nextEmission.width = emissionMaximumX - emissionMinimumX;
		nextEmission.height = emissionMaximumY - emissionMinimumY;
		for (const wave of current.waves) if (!nextRegion.waves.includes(wave)) nextRegion.waves.push(wave);
		for (const batch of current.trailBatches) if (!nextRegion.trailBatches.includes(batch)) nextRegion.trailBatches.push(batch);
		for (const shard of current.shards ?? []) if (!nextRegion.shards.includes(shard)) nextRegion.shards.push(shard);
		regions.splice(index, 1);
		index = 0;
	}
	regions.push(nextRegion);
}
function combineBloomRegionBounds(regions) {
	if (regions.length === 0) return null;
	let minimumX = Infinity;
	let minimumY = Infinity;
	let maximumX = -Infinity;
	let maximumY = -Infinity;
	for (const region of regions) {
		minimumX = Math.min(minimumX, region.x);
		minimumY = Math.min(minimumY, region.y);
		maximumX = Math.max(maximumX, region.x + region.width);
		maximumY = Math.max(maximumY, region.y + region.height);
	}
	return {
		x: minimumX,
		y: minimumY,
		width: maximumX - minimumX,
		height: maximumY - minimumY
	};
}
function random(min, max) {
	return min + Math.random() * (max - min);
}
function lerp(from, to, progress) {
	return from + (to - from) * progress;
}
function distance(from, to) {
	return Math.hypot(to.x - from.x, to.y - from.y);
}
function evaluateNumber(keys, progress) {
	if (!keys || keys.length === 0) return 0;
	const t = clamp01(progress);
	if (t <= keys[0][0]) return keys[0][1];
	for (let index = 1; index < keys.length; index++) {
		const previous = keys[index - 1];
		const current = keys[index];
		if (t <= current[0]) {
			const span = current[0] - previous[0];
			const localProgress = span > 0 ? (t - previous[0]) / span : 1;
			return lerp(previous[1], current[1], localProgress);
		}
	}
	return keys[keys.length - 1][1];
}
function evaluateUnityHermiteCurve(keys, progress) {
	if (!keys || keys.length === 0) return 0;
	const t = clamp01(progress);
	if (t <= keys[0][0]) return keys[0][1];
	for (let index = 1; index < keys.length; index++) {
		const previous = keys[index - 1];
		const current = keys[index];
		if (t <= current[0]) {
			const span = current[0] - previous[0];
			const localProgress = span > 0 ? (t - previous[0]) / span : 1;
			const squared = localProgress * localProgress;
			const cubed = squared * localProgress;
			const previousOutSlope = previous[3] ?? 0;
			const currentInSlope = current[2] ?? 0;
			const h00 = 2 * cubed - 3 * squared + 1;
			const h10 = cubed - 2 * squared + localProgress;
			const h01 = -2 * cubed + 3 * squared;
			const h11 = cubed - squared;
			return h00 * previous[1] + h10 * previousOutSlope * span + h01 * current[1] + h11 * currentInSlope * span;
		}
	}
	return keys[keys.length - 1][1];
}
function evaluateUnitySmoothCurve(keys, progress) {
	if (!keys || keys.length === 0) return 0;
	const t = clamp01(progress);
	if (t <= keys[0][0]) return keys[0][1];
	for (let index = 1; index < keys.length; index++) {
		const previous = keys[index - 1];
		const current = keys[index];
		if (t <= current[0]) {
			const span = current[0] - previous[0];
			const localProgress = span > 0 ? (t - previous[0]) / span : 1;
			const easedProgress = localProgress * localProgress * (3 - 2 * localProgress);
			return lerp(previous[1], current[1], easedProgress);
		}
	}
	return keys[keys.length - 1][1];
}
function evaluateColor(keys, progress, output = [
	0,
	0,
	0
]) {
	if (!keys || keys.length === 0) {
		output[0] = 0;
		output[1] = 0;
		output[2] = 0;
		return output;
	}
	const t = clamp01(progress);
	if (t <= keys[0][0]) {
		output[0] = keys[0][1][0];
		output[1] = keys[0][1][1];
		output[2] = keys[0][1][2];
		return output;
	}
	for (let index = 1; index < keys.length; index++) {
		const previous = keys[index - 1];
		const current = keys[index];
		if (t <= current[0]) {
			const span = current[0] - previous[0];
			const localProgress = span > 0 ? (t - previous[0]) / span : 1;
			output[0] = lerp(previous[1][0], current[1][0], localProgress);
			output[1] = lerp(previous[1][1], current[1][1], localProgress);
			output[2] = lerp(previous[1][2], current[1][2], localProgress);
			return output;
		}
	}
	const finalColor = keys[keys.length - 1][1];
	output[0] = finalColor[0];
	output[1] = finalColor[1];
	output[2] = finalColor[2];
	return output;
}
function colorToCss(color, alpha = 1) {
	const themed = applyThemeColor(color);
	return `rgba(${Math.round(clamp(themed[0], 0, 255))}, ${Math.round(clamp(themed[1], 0, 255))}, ${Math.round(clamp(themed[2], 0, 255))}, ${clamp01(alpha)})`;
}
function scaleNativeGlowAlpha(alpha, emissionScale) {
	const baseAlpha = clamp01(alpha);
	const safeScale = Math.max(0, emissionScale);
	return 1 - (1 - baseAlpha) ** safeScale;
}
function srgbToLinearChannel(channel) {
	const normalized = clamp01(channel / 255);
	if (normalized <= .04045) return normalized / 12.92;
	return ((normalized + .055) / 1.055) ** 2.4;
}
function colorToLinearEnergy(color, intensity = 1, decodeSrgb = false) {
	const safeIntensity = Math.max(0, intensity);
	if (relativeOklchTheme && !relativeOklchTheme.identity) return applyRelativeOklchTheme(decodeSrgb ? color : color.map((channel) => linearToSrgb(clamp01(channel / 255)) * 255), relativeOklchTheme).map((channel) => srgbToLinearChannel(channel) * safeIntensity);
	return (relativeOklchTheme?.identity ? color : applyThemeHue(color)).map((channel) => {
		return (decodeSrgb ? srgbToLinearChannel(channel) : clamp01(channel / 255)) * safeIntensity;
	});
}
function evaluateSrgbGradientEnergy(keys, progress, intensity, startColor = null) {
	const linearKeys = keys.map(([time, color]) => [time, applyThemeColor(color).map(srgbToLinearChannel)]);
	const safeIntensity = Math.max(0, intensity);
	const linearStartColor = startColor ? startColor.map((channel) => srgbToLinearChannel(channel * 255)) : [
		1,
		1,
		1
	];
	return evaluateColor(linearKeys, progress).map((channel, index) => channel * linearStartColor[index] * safeIntensity);
}
/**
* 将 Shader 线性能量按 Unity 捕获图的通道值编码为预乘加色贡献；
* 清晰本体不做额外 gamma 提亮，零 RGB 必然得到零 Alpha。
*/
function linearEnergyToAdditiveCss(color, opacity = 1) {
	const safeOpacity = clamp01(opacity);
	const red = clamp01(color[0] * safeOpacity);
	const green = clamp01(color[1] * safeOpacity);
	const blue = clamp01(color[2] * safeOpacity);
	const alpha = Math.max(red, green, blue);
	if (alpha <= 1e-5) return "rgba(0, 0, 0, 0)";
	return `rgba(${Math.round(red / alpha * 255)}, ${Math.round(green / alpha * 255)}, ${Math.round(blue / alpha * 255)}, ${alpha})`;
}
/**
* 为 DOM plus-lighter/宿主 Add 保存完整的 sRGB 发射载荷。
*
* scene Canvas 允许把 Linear 能量直接相加，最终由 Scene Final Pass
* 统一编码；普通 Canvas 回退没有这个 Final Pass，若继续写 Linear 数值，
* CSS 会把它当作 sRGB 解释，低能量尤其容易变暗。因此这里在每个回退
* 图层边界编码一次，并用独立 Coverage 作为最小传输 Alpha。
*/
function resolveHostAdditivePayload(color, contributionOpacity = 1, coverageAlpha = contributionOpacity) {
	const contribution = Math.max(0, contributionOpacity);
	const red = linearToSrgb(Math.max(0, color[0]) * contribution);
	const green = linearToSrgb(Math.max(0, color[1]) * contribution);
	const blue = linearToSrgb(Math.max(0, color[2]) * contribution);
	const alpha = clamp01(Math.max(red, green, blue, clamp01(coverageAlpha)));
	if (alpha <= 1e-5) return [
		0,
		0,
		0,
		0
	];
	return [
		red / alpha,
		green / alpha,
		blue / alpha,
		alpha
	];
}
function linearEnergyToHostAdditiveCss(color, contributionOpacity = 1, coverageAlpha = contributionOpacity) {
	const [red, green, blue, alpha] = resolveHostAdditivePayload(color, contributionOpacity, coverageAlpha);
	if (alpha <= 1e-5) return "rgba(0, 0, 0, 0)";
	return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${alpha})`;
}
function resolveOverlayStraightColor(color, contributionOpacity, coverageAlpha, overlayColorCompensation = "none", globalOpacity = 1) {
	const requestedAlpha = clamp01(coverageAlpha);
	if (requestedAlpha <= 1e-5) return [
		0,
		0,
		0
	];
	const contribution = Math.max(0, contributionOpacity);
	let red = clamp01(linearToSrgb(Math.max(0, color[0]) * contribution) / requestedAlpha);
	let green = clamp01(linearToSrgb(Math.max(0, color[1]) * contribution) / requestedAlpha);
	let blue = clamp01(linearToSrgb(Math.max(0, color[2]) * contribution) / requestedAlpha);
	if (overlayColorCompensation === "bright-core") {
		const compensated = compensateBrightCorePremultipliedRgb([
			red * requestedAlpha,
			green * requestedAlpha,
			blue * requestedAlpha
		], requestedAlpha, globalOpacity);
		red = compensated[0] / requestedAlpha;
		green = compensated[1] / requestedAlpha;
		blue = compensated[2] / requestedAlpha;
	}
	return [
		red,
		green,
		blue
	];
}
function resolveOverlayCompensation(color, contributionOpacity, coverageAlpha, globalOpacity = 1) {
	const safeOpacity = Math.max(clamp01(globalOpacity), 1e-6);
	const normalizedCoverage = clamp01(clamp01(coverageAlpha) / safeOpacity);
	const normalizedEnergy = linearToSrgb(Math.max(...color) * Math.max(0, contributionOpacity) / safeOpacity);
	return smoothstep(.25, .75, normalizedEnergy / Math.max(normalizedCoverage, 1e-6)) * smoothstep(.03125, .25, normalizedEnergy);
}
function colorToCanvasOutputCss(color, alpha, linearOutput = false) {
	if (!linearOutput) return colorToCss(color, alpha);
	return linearEnergyToAdditiveCss(colorToLinearEnergy(color, 1, true), alpha);
}
/**
* 将线性能量编码为指定 Coverage 的预乘颜色。超出 Coverage 可承载范围的
* HDR 能量在清晰层钳制，完整能量仍由独立 Bloom 发射路径保留。
*/
function linearEnergyToOverlayCss(color, contributionOpacity, coverageAlpha, overlayColorCompensation = "none", overlayAlphaLimit = 1, globalOpacity = 1) {
	const requestedAlpha = clamp01(coverageAlpha);
	const alpha = Math.min(requestedAlpha, clamp01(overlayAlphaLimit));
	if (alpha <= 1e-5) return "rgba(0, 0, 0, 0)";
	const [red, green, blue] = resolveOverlayStraightColor(color, contributionOpacity, requestedAlpha, overlayColorCompensation, globalOpacity);
	return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${alpha})`;
}
/**
* 原生 Canvas 无法保留 HDR，因此先按 Unity MXFinalBloom 提取高亮，
* 再用回退强度映射到可模糊的加色源，避免低能尾段也产生均匀光雾。
*/
function linearEnergyToNativeTrailBloomCss(color, opacity, intensity, bloomCfg, outputCompositing = "scene", coverageOpacity = opacity, overlayColorCompensation = "none", overlayAlphaLimit = 1) {
	const sourceScale = clamp01(opacity) * Math.max(0, intensity);
	const source = color.map((channel) => Math.max(0, channel * sourceScale));
	const brightness = Math.max(...source);
	if (brightness <= 0) return "rgba(0, 0, 0, 0)";
	const contribution = calculateBloomContribution(brightness, gammaToLinear(bloomCfg.threshold), bloomCfg.softKnee);
	if (contribution <= 0) return "rgba(0, 0, 0, 0)";
	const contributionScale = contribution / brightness;
	const brightPass = source.map((channel) => channel * contributionScale);
	if (outputCompositing === "browser-overlay") {
		const coverage = clamp01(coverageOpacity);
		return linearEnergyToOverlayCss(brightPass, bloomCfg.trailAlpha, coverage, overlayColorCompensation, overlayAlphaLimit, opacity);
	}
	if (outputCompositing === "host-additive") return linearEnergyToHostAdditiveCss(brightPass, bloomCfg.trailAlpha, coverageOpacity);
	return linearEnergyToAdditiveCss(brightPass, bloomCfg.trailAlpha);
}
function linearEnergyToEmissionCss(color, opacity, emissionRange, energyScale = 1) {
	const scale = clamp01(opacity) * Math.max(0, energyScale) / Math.max(1, emissionRange);
	return `rgb(${Math.round(clamp(color[0] * scale * 255, 0, 255))}, ${Math.round(clamp(color[1] * scale * 255, 0, 255))}, ${Math.round(clamp(color[2] * scale * 255, 0, 255))})`;
}
function isOffscreenCanvas(value) {
	return typeof OffscreenCanvas !== "undefined" && value instanceof OffscreenCanvas;
}
function isCanvas(value) {
	if (!value) return false;
	if (typeof HTMLCanvasElement !== "undefined" && value instanceof HTMLCanvasElement) return true;
	if (isOffscreenCanvas(value)) return true;
	return value?.tagName?.toLowerCase?.() === "canvas";
}
function getCompositingReferenceDimensions(source) {
	if (!source) return null;
	let width;
	let height;
	try {
		width = source.naturalWidth ?? source.videoWidth ?? source.displayWidth ?? source.width;
		height = source.naturalHeight ?? source.videoHeight ?? source.displayHeight ?? source.height;
	} catch {
		return null;
	}
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	return {
		width,
		height
	};
}
function resolveTarget(target) {
	if (typeof target === "string") return typeof document !== "undefined" && typeof document.querySelector === "function" ? document.querySelector(target) : null;
	return target ?? null;
}
function createCanvas(width = 300, height = 150) {
	if (typeof document !== "undefined" && typeof document.createElement === "function") {
		const canvas = document.createElement("canvas");
		canvas.setAttribute?.("aria-hidden", "true");
		return canvas;
	}
	if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
	return null;
}
function getTriangleTextureResources() {
	if (triangleTextureResources) return triangleTextureResources;
	if (triangleTextureUnavailable) return null;
	const sources = createTriangleTextureSources(createCanvas);
	const canvas = createCanvas();
	const context = canvas.getContext("2d");
	if (!sources || !context) {
		triangleTextureUnavailable = true;
		return null;
	}
	canvas.width = 128;
	canvas.height = 128;
	triangleTextureResources = {
		...sources,
		canvas,
		context,
		linearTextureRgba: TRIANGLE_TEXTURE_RGBA,
		linearTextureCoverage: TRIANGLE_TEXTURE_COVERAGE,
		linearTextureCoverageFromSrgbRed: false,
		linearTextureRgb: null,
		linearTextureEnergyRgb: null,
		linearTintFrameCount: 2,
		linearTintFrames: null,
		linearTintUnavailable: false
	};
	return triangleTextureResources;
}
function getCircleTextureResources() {
	if (circleTextureResources) return circleTextureResources;
	if (circleTextureUnavailable) return null;
	const sources = createCircleTextureSources(createCanvas);
	if (!sources) {
		circleTextureUnavailable = true;
		return null;
	}
	const tintCanvas = createCanvas();
	const outputCanvas = createCanvas();
	const tintContext = tintCanvas.getContext("2d");
	const outputContext = outputCanvas.getContext("2d");
	if (!tintContext || !outputContext) {
		circleTextureUnavailable = true;
		return null;
	}
	tintCanvas.width = 512;
	tintCanvas.height = 512;
	outputCanvas.width = 512;
	outputCanvas.height = 512;
	circleTextureResources = {
		...sources,
		tintCanvas,
		tintContext,
		outputCanvas,
		outputContext,
		linearTextureRgba: CIRCLE_TEXTURE_RGBA,
		linearTextureCoverage: null,
		linearTextureCoverageFromSrgbRed: true,
		linearTextureRgb: null,
		linearTextureEnergyRgb: null,
		linearTintFrameCount: 1,
		linearTintFrames: null,
		linearTintUnavailable: false
	};
	return circleTextureResources;
}
function prepareLinearTextureData(resources) {
	if (resources.linearTextureEnergyRgb) return;
	const rgba = resources.linearTextureRgba;
	const pixelCount = rgba.length / 4;
	const coverage = resources.linearTextureCoverage ?? new Uint8Array(pixelCount);
	const textureRgb = new Float32Array(pixelCount * 3);
	const energyRgb = new Float32Array(pixelCount * 3);
	for (let sourceOffset = 0, pixelIndex = 0, targetOffset = 0; sourceOffset < rgba.length; sourceOffset += 4, pixelIndex++, targetOffset += 3) {
		const exactCoverage = resources.linearTextureCoverageFromSrgbRed ? srgbToLinearChannel(rgba[sourceOffset]) : coverage[pixelIndex] / 255;
		if (resources.linearTextureCoverageFromSrgbRed) coverage[pixelIndex] = Math.round(clamp01(exactCoverage) * 255);
		textureRgb[targetOffset] = srgbToLinearChannel(rgba[sourceOffset]);
		textureRgb[targetOffset + 1] = srgbToLinearChannel(rgba[sourceOffset + 1]);
		textureRgb[targetOffset + 2] = srgbToLinearChannel(rgba[sourceOffset + 2]);
		energyRgb[targetOffset] = textureRgb[targetOffset] * exactCoverage;
		energyRgb[targetOffset + 1] = textureRgb[targetOffset + 1] * exactCoverage;
		energyRgb[targetOffset + 2] = textureRgb[targetOffset + 2] * exactCoverage;
	}
	resources.linearTextureCoverage = coverage;
	resources.linearTextureRgb = textureRgb;
	resources.linearTextureEnergyRgb = energyRgb;
}
function sampleTextureChannel(data, textureSize, stride, u, v, channel = 0) {
	const sourceX = clamp(u * textureSize - .5, 0, textureSize - 1);
	const sourceY = clamp(v * textureSize - .5, 0, textureSize - 1);
	const left = Math.floor(sourceX);
	const top = Math.floor(sourceY);
	const right = Math.min(textureSize - 1, left + 1);
	const bottom = Math.min(textureSize - 1, top + 1);
	const horizontal = sourceX - left;
	const vertical = sourceY - top;
	const topLeft = data[(top * textureSize + left) * stride + channel];
	const topRight = data[(top * textureSize + right) * stride + channel];
	const bottomLeft = data[(bottom * textureSize + left) * stride + channel];
	const bottomRight = data[(bottom * textureSize + right) * stride + channel];
	const topSample = topLeft + (topRight - topLeft) * horizontal;
	return topSample + (bottomLeft + (bottomRight - bottomLeft) * horizontal - topSample) * vertical;
}
const LINEAR_TO_SRGB_LUT_SIZE = 4096;
let linearToSrgbLut = null;
function getLinearToSrgbLut() {
	if (linearToSrgbLut) return linearToSrgbLut;
	linearToSrgbLut = new Float32Array(LINEAR_TO_SRGB_LUT_SIZE);
	for (let index = 0; index < LINEAR_TO_SRGB_LUT_SIZE; index++) linearToSrgbLut[index] = linearToSrgb(index / 4095);
	return linearToSrgbLut;
}
function createLinearTintFrames(textureSize, frameCount) {
	const frames = [];
	try {
		for (let index = 0; index < frameCount; index++) {
			const canvas = createCanvas();
			canvas.width = textureSize;
			canvas.height = textureSize;
			const context = canvas.getContext("2d");
			if (!context || typeof context.createImageData !== "function" || typeof context.putImageData !== "function") throw new Error("Canvas ImageData is unavailable");
			frames.push({
				canvas,
				context,
				image: context.createImageData(textureSize, textureSize),
				key: null
			});
		}
	} catch {
		for (const frame of frames) {
			frame.canvas.width = 0;
			frame.canvas.height = 0;
		}
		return null;
	}
	return frames;
}
/**
* Canvas 没有 Unity 的线性采样/材质乘法状态；透明回退必须在写入 8 位
* Canvas 前完成逐 texel 的 Linear(texture) × Linear(material)，否则 WebGL2
* 丢失后会把已编码 sRGB 材质再次相乘而明显变暗。
*/
function prepareLinearTintedTextureCanvas(resources, textureSize, materialEnergy, contribution, alphaDivisor, frameIndex = 0, compensation = 0, shape = null) {
	const safeContribution = Math.max(0, Number(contribution) || 0);
	const safeDivisor = Math.max(0, Number(alphaDivisor) || 0);
	const safeMaterialEnergy = [
		0,
		1,
		2
	].map((channel) => Math.max(0, Number(materialEnergy[channel]) || 0));
	const safeCompensation = clamp01(Number(compensation) || 0);
	const roundness = clamp01(Number(shape?.roundness) || 0);
	const shapeCoverage = shape?.coverage ?? null;
	const useTextureAlpha = shape?.useTextureAlpha === true;
	const useRoundedShape = roundness > 0 && shapeCoverage !== null;
	if (safeContribution <= 1e-6 || safeDivisor <= 1e-6 || Math.max(...safeMaterialEnergy) <= 1e-6 || resources.linearTintUnavailable) return null;
	if (!resources.linearTintFrames) {
		resources.linearTintFrames = createLinearTintFrames(textureSize, resources.linearTintFrameCount);
		if (!resources.linearTintFrames) {
			resources.linearTintUnavailable = true;
			return null;
		}
	}
	prepareLinearTextureData(resources);
	const frameSlot = ((Number.isFinite(frameIndex) ? Math.trunc(frameIndex) : 0) % resources.linearTintFrameCount + resources.linearTintFrameCount) % resources.linearTintFrameCount;
	const frame = resources.linearTintFrames[frameSlot];
	const key = [
		safeDivisor,
		safeContribution,
		...safeMaterialEnergy,
		safeCompensation,
		roundness,
		useTextureAlpha
	].join(",");
	if (frame.key === key) return frame.canvas;
	const { context, image } = frame;
	const sourceEnergyRgb = resources.linearTextureEnergyRgb;
	const sourceTextureRgb = resources.linearTextureRgb;
	const sourceCoverage = resources.linearTextureCoverage;
	const sourceRgba = resources.linearTextureRgba;
	const srgbLut = getLinearToSrgbLut();
	const flipVertical = frameSlot === 1;
	const encodeChannel = (sourceOffset, channel, straightDivisor) => {
		const linear = clamp01(sourceEnergyRgb[sourceOffset + channel] * safeMaterialEnergy[channel] * safeContribution);
		const lookupIndex = Math.round(linear * 4095);
		return srgbLut[lookupIndex] / straightDivisor;
	};
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.globalAlpha = 1;
	context.globalCompositeOperation = "source-over";
	context.filter = "none";
	context.imageSmoothingEnabled = false;
	for (let y = 0; y < textureSize; y++) {
		const sourceY = flipVertical ? textureSize - 1 - y : y;
		for (let x = 0; x < textureSize; x++) {
			const sourcePixelIndex = sourceY * textureSize + x;
			const sourceOffset = sourcePixelIndex * 3;
			const sourceRgbaOffset = sourcePixelIndex * 4;
			const outputOffset = (y * textureSize + x) * 4;
			const originalCoverage = useTextureAlpha ? sourceRgba[sourceRgbaOffset + 3] / 255 : sourceCoverage[sourcePixelIndex] / 255;
			let sampleU = (x + .5) / textureSize;
			let sampleV = (sourceY + .5) / textureSize;
			if (useRoundedShape) [sampleU, sampleV] = mapRoundedTriangleTextureUv(sampleU, sampleV, roundness);
			const textureSupport = useRoundedShape ? (useTextureAlpha ? sampleTextureChannel(sourceRgba, textureSize, 4, sampleU, sampleV, 3) : sampleTextureChannel(sourceCoverage, textureSize, 1, sampleU, sampleV)) / 255 : originalCoverage;
			const targetCoverage = useRoundedShape ? shapeCoverage[sourcePixelIndex] / 255 : originalCoverage;
			const coverageByte = Math.round(clamp01(targetCoverage) * 255);
			if (coverageByte === 0) {
				image.data[outputOffset] = 0;
				image.data[outputOffset + 1] = 0;
				image.data[outputOffset + 2] = 0;
				image.data[outputOffset + 3] = 0;
				continue;
			}
			const straightDivisor = safeDivisor * (coverageByte / 255);
			const encodeRoundedChannel = (channel) => {
				if (roundness <= 0) return encodeChannel(sourceOffset, channel, straightDivisor);
				const supportedChannel = 1 + (sampleTextureChannel(sourceTextureRgb, textureSize, 3, sampleU, sampleV, channel) - 1) * clamp01(textureSupport);
				const linear = clamp01((supportedChannel + (1 - supportedChannel) * roundness) * targetCoverage * safeMaterialEnergy[channel] * safeContribution);
				const lookupIndex = Math.round(linear * 4095);
				return srgbLut[lookupIndex] / straightDivisor;
			};
			const red = encodeRoundedChannel(0);
			const green = encodeRoundedChannel(1);
			const blue = encodeRoundedChannel(2);
			const maximum = Math.max(red, green, blue);
			const mixAmount = BRIGHT_CORE_CHANNEL_MIX * safeCompensation * clamp01(maximum);
			image.data[outputOffset] = Math.round(clamp01(red + (maximum - red) * mixAmount) * 255);
			image.data[outputOffset + 1] = Math.round(clamp01(green + (maximum - green) * mixAmount) * 255);
			image.data[outputOffset + 2] = Math.round(clamp01(blue + (maximum - blue) * mixAmount) * 255);
			image.data[outputOffset + 3] = coverageByte;
		}
	}
	context.putImageData(image, 0, 0);
	context.globalCompositeOperation = "source-over";
	context.filter = "none";
	frame.key = key;
	return frame.canvas;
}
/**
* 用固定大小的 Canvas 合成 Circle_01 二维 RGB 与 R Coverage。
*
* 动态材质只触发局部 GPU/Canvas 操作，不重新遍历 512x512 texel；这样既
* 保留 G 通道的非径向细节，也不会重新引入旧逐帧 CPU 卡顿。
*/
function prepareCircleTextureCanvas(channelScales, srgbOutput = false) {
	const resources = getCircleTextureResources();
	const maximumScale = Math.max(0, ...channelScales);
	if (!resources || maximumScale <= 1e-5) return null;
	const normalizedChannels = channelScales.map((channel) => Math.round(clamp01(channel / maximumScale) * 255));
	const { tintCanvas, tintContext, outputCanvas, outputContext } = resources;
	tintContext.setTransform(1, 0, 0, 1, 0, 0);
	tintContext.globalAlpha = 1;
	tintContext.globalCompositeOperation = "source-over";
	tintContext.filter = "none";
	tintContext.clearRect(0, 0, 512, 512);
	tintContext.drawImage(srgbOutput ? resources.srgbColorCanvas : resources.colorCanvas, 0, 0);
	tintContext.globalCompositeOperation = "multiply";
	tintContext.fillStyle = `rgb(${normalizedChannels[0]}, ${normalizedChannels[1]}, ${normalizedChannels[2]})`;
	tintContext.fillRect(0, 0, 512, 512);
	outputContext.setTransform(1, 0, 0, 1, 0, 0);
	outputContext.globalAlpha = 1;
	outputContext.globalCompositeOperation = "source-over";
	outputContext.filter = `brightness(${Math.min(maximumScale, 255)})`;
	outputContext.clearRect(0, 0, 512, 512);
	outputContext.drawImage(tintCanvas, 0, 0);
	outputContext.filter = "none";
	outputContext.globalCompositeOperation = "destination-in";
	outputContext.drawImage(resources.coverageCanvas, 0, 0);
	return outputCanvas;
}
function createOverlayRoot(fixed) {
	const root = document.createElement("div");
	root.setAttribute("aria-hidden", "true");
	root.style.position = fixed ? "fixed" : "absolute";
	root.style.inset = "0";
	root.style.width = "100%";
	root.style.height = "100%";
	root.style.pointerEvents = "none";
	root.style.zIndex = "2147483647";
	root.style.isolation = "isolate";
	return root;
}
function setOverlayStyle(canvas, fixed, zIndex = "2147483647", mixBlendMode = "plus-lighter") {
	if (!canvas?.style) return;
	canvas.style.position = fixed ? "fixed" : "absolute";
	canvas.style.inset = "0";
	canvas.style.width = "100%";
	canvas.style.height = "100%";
	canvas.style.pointerEvents = "none";
	canvas.style.zIndex = zIndex;
	canvas.style.mixBlendMode = mixBlendMode;
}
function evaluateRingTextureAlpha(angularProgress, radialProgress, ringCfg) {
	const uvSpan = ringCfg.textureUvMax - ringCfg.textureUvMin;
	return sampleRing3Alpha(ringCfg.textureUvMin + uvSpan * clamp01(angularProgress), ringCfg.textureUvMin + uvSpan * clamp01(radialProgress));
}
function evaluateRingLuminance(angularProgress, radialProgress, threshold, ringCfg) {
	const textureAlpha = evaluateRingTextureAlpha(angularProgress, radialProgress, ringCfg);
	return textureAlpha >= threshold ? textureAlpha : 0;
}
function resolveRingTextureProgress(angularProgress, direction) {
	return direction > 0 ? angularProgress : 1 - angularProgress;
}
function findRingClipBoundary(angularStart, angularEnd, radialProgress, threshold, direction, ringCfg) {
	let start = angularStart;
	let end = angularEnd;
	const startVisible = evaluateRingTextureAlpha(resolveRingTextureProgress(start, direction), radialProgress, ringCfg) >= threshold;
	for (let iteration = 0; iteration < 8; iteration++) {
		const middle = (start + end) * .5;
		if (evaluateRingTextureAlpha(resolveRingTextureProgress(middle, direction), radialProgress, ringCfg) >= threshold === startVisible) start = middle;
		else end = middle;
	}
	return (start + end) * .5;
}
function createDissolvedRingGradient(context, ringCfg, threshold, radialProgress, colorForLuminance) {
	if (typeof context.createConicGradient !== "function") return null;
	const gradient = context.createConicGradient(0, 0, 0);
	const sampleCount = Math.max(32, ringCfg.arcSamples);
	const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;
	let previousLuminance = null;
	for (let sample = 0; sample <= sampleCount; sample++) {
		const angularProgress = sample / sampleCount;
		const luminance = evaluateRingLuminance(resolveRingTextureProgress(angularProgress, direction), radialProgress, threshold, ringCfg);
		if (previousLuminance !== null && previousLuminance > 0 !== luminance > 0) {
			const boundary = findRingClipBoundary((sample - 1) / sampleCount, angularProgress, radialProgress, threshold, direction, ringCfg);
			const visibleBoundary = colorForLuminance(threshold);
			const transparentBoundary = colorForLuminance(0);
			if (previousLuminance > 0) {
				gradient.addColorStop(boundary, visibleBoundary);
				gradient.addColorStop(boundary, transparentBoundary);
			} else {
				gradient.addColorStop(boundary, transparentBoundary);
				gradient.addColorStop(boundary, visibleBoundary);
			}
		}
		gradient.addColorStop(angularProgress, colorForLuminance(luminance));
		previousLuminance = luminance;
	}
	return gradient;
}
function fillDissolvedRingFallback(context, radius, width, threshold, ringCfg, radialProgress, colorForLuminance) {
	const circumference = TAU * radius;
	const segmentCount = Math.max(ringCfg.arcSamples, Math.ceil(circumference));
	const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;
	for (let segment = 0; segment < segmentCount; segment++) {
		const angularStart = segment / segmentCount;
		const angularEnd = (segment + 1) / segmentCount;
		const luminance = evaluateRingLuminance(resolveRingTextureProgress((angularStart + angularEnd) * .5, direction), radialProgress, threshold, ringCfg);
		if (luminance <= 0) continue;
		context.beginPath();
		context.arc(0, 0, radius, angularStart * TAU, angularEnd * TAU, false);
		context.lineCap = "butt";
		context.lineWidth = Math.max(.5, width);
		context.strokeStyle = colorForLuminance(luminance);
		context.stroke();
	}
}
function fillDissolvedRing(context, radius, width, threshold, ringCfg, colorForLuminance, nativeShadow = null) {
	const radialSamples = Math.max(1, Math.round(ringCfg.radialSamples));
	const innerEdge = Math.max(0, radius - width * .5);
	const bandWidth = width / radialSamples;
	for (let band = 0; band < radialSamples; band++) {
		const innerRadius = innerEdge + bandWidth * band;
		const outerRadius = innerEdge + bandWidth * (band + 1);
		const radialProgress = (band + .5) / radialSamples;
		const gradient = createDissolvedRingGradient(context, ringCfg, threshold, radialProgress, colorForLuminance);
		if (!gradient) {
			fillDissolvedRingFallback(context, (innerRadius + outerRadius) * .5, bandWidth, threshold, ringCfg, radialProgress, colorForLuminance);
			continue;
		}
		const isCenterBand = band === Math.floor(radialSamples * .5);
		context.shadowBlur = isCenterBand && nativeShadow ? nativeShadow.blur : 0;
		context.shadowColor = isCenterBand && nativeShadow ? nativeShadow.color : "transparent";
		context.beginPath();
		context.arc(0, 0, outerRadius, 0, TAU, false);
		context.arc(0, 0, innerRadius, TAU, 0, true);
		context.closePath();
		context.fillStyle = gradient;
		context.fill();
	}
}
function resolveRingGeometry(ring, progress, scale, ringCfg) {
	const size = evaluateUnityHermiteCurve(ringCfg.sizeKeys, progress);
	const outerRadius = ring.radius * size * scale;
	const widthMultiplier = lerp(ringCfg.widthStart, ringCfg.widthEnd, progress);
	const width = outerRadius * ringCfg.bandToOuterRadius * widthMultiplier;
	return {
		radius: outerRadius - width * .5,
		width,
		threshold: clamp01(evaluateUnityHermiteCurve(ringCfg.dissolveKeys, progress))
	};
}
function drawDissolvedCircle(context, ring, progress, scale, opacity, fxConfig = UNITY_FX_TOUCH, useNativeBloom = true, sharedMaterialEnergy = null, outputCompositing = "scene", linearNativeGlow = false, dpr = 1, overlayColorCompensation = "none", overlayAlphaLimit = 1) {
	const ringCfg = fxConfig.rings;
	const bloomCfg = fxConfig.bloom;
	const geometry = resolveRingGeometry(ring, progress, scale, ringCfg);
	const particleColor = evaluateColor(ringCfg.colorKeys, progress);
	if (geometry.width <= .001) return;
	const materialEnergy = sharedMaterialEnergy ?? evaluateSrgbGradientEnergy(ringCfg.colorKeys, progress, ringCfg.hdrIntensity);
	const colorForLuminance = (luminance) => {
		const coverage = opacity * luminance;
		if (outputCompositing === "browser-overlay") return linearEnergyToOverlayCss(materialEnergy, coverage, coverage, overlayColorCompensation, overlayAlphaLimit, opacity);
		return outputCompositing === "host-additive" ? linearEnergyToHostAdditiveCss(materialEnergy, coverage, coverage) : linearEnergyToAdditiveCss(materialEnergy, coverage);
	};
	context.save();
	context.translate(ring.x, ring.y);
	context.rotate(ring.rotation);
	const ringGlowAlpha = scaleNativeGlowAlpha(opacity * bloomCfg.ringAlpha, bloomCfg.clickEmissionScale);
	let ringGlowColor;
	if (outputCompositing === "browser-overlay") ringGlowColor = linearEnergyToOverlayCss(colorToLinearEnergy(particleColor, 1, true), ringGlowAlpha, ringGlowAlpha, overlayColorCompensation, overlayAlphaLimit, opacity);
	else if (outputCompositing === "host-additive") ringGlowColor = linearEnergyToHostAdditiveCss(colorToLinearEnergy(particleColor, 1, true), ringGlowAlpha, ringGlowAlpha);
	else ringGlowColor = colorToCanvasOutputCss(particleColor, ringGlowAlpha, linearNativeGlow);
	fillDissolvedRing(context, geometry.radius, geometry.width, geometry.threshold, ringCfg, colorForLuminance, useNativeBloom ? {
		blur: bloomCfg.ringBlur * scale * dpr,
		color: ringGlowColor
	} : null);
	context.restore();
}
function drawDissolvedCircleEmission(context, ring, progress, scale, opacity, fxConfig = UNITY_FX_TOUCH, sharedMaterialEnergy = null) {
	const ringCfg = fxConfig.rings;
	const bloomCfg = fxConfig.bloom;
	const geometry = resolveRingGeometry(ring, progress, scale, ringCfg);
	if (geometry.width <= .001) return;
	const materialEnergy = sharedMaterialEnergy ?? evaluateSrgbGradientEnergy(ringCfg.colorKeys, progress, ringCfg.hdrIntensity);
	context.save();
	context.translate(ring.x, ring.y);
	context.rotate(ring.rotation);
	fillDissolvedRing(context, geometry.radius, geometry.width, geometry.threshold, ringCfg, (luminance) => linearEnergyToEmissionCss(materialEnergy, opacity * luminance * bloomCfg.ringEmissionAlpha, bloomCfg.emissionRange, bloomCfg.clickEmissionScale));
	context.restore();
}
function drawDisk(context, wave, progress, scale, opacity, fxConfig = UNITY_FX_TOUCH, useNativeBloom = true, dpr = 1, outputCompositing = "scene", overlayColorCompensation = "none", overlayAlphaLimit = 1) {
	const diskCfg = fxConfig.disk;
	const bloomCfg = fxConfig.bloom;
	const size = evaluateUnityHermiteCurve(diskCfg.sizeKeys, progress);
	const radius = diskCfg.radius * size * scale;
	const color = evaluateColor(diskCfg.colorKeys, progress);
	const particleAlpha = evaluateNumber(diskCfg.alphaKeys, progress);
	if (radius <= 0 || particleAlpha <= 0) return;
	const materialEnergy = evaluateSrgbGradientEnergy(diskCfg.colorKeys, progress, bloomCfg.diskEmission);
	const coverageAlpha = particleAlpha * opacity;
	let textureAlpha = clamp01(coverageAlpha);
	let textureCanvas;
	if (outputCompositing === "browser-overlay") {
		textureAlpha = Math.min(textureAlpha, clamp01(overlayAlphaLimit));
		const resources = getCircleTextureResources();
		const compensation = overlayColorCompensation === "bright-core" ? resolveOverlayCompensation(materialEnergy, opacity, coverageAlpha, opacity) : 0;
		if (resources && textureAlpha > 1e-6) textureCanvas = prepareLinearTintedTextureCanvas(resources, 512, materialEnergy, opacity, coverageAlpha, 0, compensation);
	} else if (outputCompositing === "host-additive") {
		textureAlpha = resolveHostAdditivePayload(materialEnergy, opacity, coverageAlpha)[3];
		const resources = getCircleTextureResources();
		if (resources) textureCanvas = prepareLinearTintedTextureCanvas(resources, 512, materialEnergy, opacity, textureAlpha);
	} else textureCanvas = prepareCircleTextureCanvas(materialEnergy.map((channel) => channel / Math.max(particleAlpha, 1e-5)));
	if (!textureCanvas) return;
	context.save();
	context.globalCompositeOperation = "source-over";
	context.translate(wave.x, wave.y);
	context.rotate(wave.diskRotation);
	context.globalAlpha = textureAlpha;
	const shadowAlpha = scaleNativeGlowAlpha(opacity * bloomCfg.diskAlpha, bloomCfg.clickEmissionScale);
	if (outputCompositing === "browser-overlay") context.shadowColor = linearEnergyToOverlayCss(colorToLinearEnergy(color, 1, true), shadowAlpha, shadowAlpha, overlayColorCompensation, overlayAlphaLimit, opacity);
	else if (outputCompositing === "host-additive") context.shadowColor = linearEnergyToHostAdditiveCss(colorToLinearEnergy(color, 1, true), shadowAlpha, shadowAlpha);
	else context.shadowColor = colorToCss(color, shadowAlpha);
	context.shadowBlur = useNativeBloom ? bloomCfg.diskBlur * scale * dpr : 0;
	context.drawImage(textureCanvas, 0, 0, 512, 512, -radius, -radius, radius * 2, radius * 2);
	context.restore();
}
function drawDiskNativeGlow(context, wave, progress, scale, opacity, fxConfig = UNITY_FX_TOUCH, dpr = 1) {
	const diskCfg = fxConfig.disk;
	const bloomCfg = fxConfig.bloom;
	const radius = diskCfg.radius * evaluateUnityHermiteCurve(diskCfg.sizeKeys, progress) * scale;
	const blur = bloomCfg.diskBlur * scale * dpr;
	if (radius <= 0 || blur <= 0) return;
	const color = evaluateColor(diskCfg.colorKeys, progress);
	const shadowAlpha = scaleNativeGlowAlpha(opacity * bloomCfg.diskAlpha, bloomCfg.clickEmissionScale);
	context.save();
	context.globalCompositeOperation = "lighter";
	context.beginPath();
	context.arc(wave.x, wave.y, radius, 0, TAU);
	context.fillStyle = "rgb(0, 0, 0)";
	context.shadowColor = colorToCanvasOutputCss(color, shadowAlpha, true);
	context.shadowBlur = blur;
	context.fill();
	context.restore();
}
function drawDiskEmission(context, wave, progress, scale, opacity, fxConfig = UNITY_FX_TOUCH) {
	const diskCfg = fxConfig.disk;
	const bloomCfg = fxConfig.bloom;
	const radius = diskCfg.radius * evaluateUnityHermiteCurve(diskCfg.sizeKeys, progress) * scale;
	const textureCanvas = prepareCircleTextureCanvas(evaluateSrgbGradientEnergy(diskCfg.colorKeys, progress, bloomCfg.diskEmission).map((channel) => channel * bloomCfg.clickEmissionScale / bloomCfg.emissionRange));
	if (radius <= 0 || !textureCanvas) return;
	context.save();
	context.translate(wave.x, wave.y);
	context.rotate(wave.diskRotation);
	context.globalAlpha = clamp01(opacity * bloomCfg.diskEmissionAlpha);
	context.drawImage(textureCanvas, 0, 0, 512, 512, -radius, -radius, radius * 2, radius * 2);
	context.restore();
}
function drawDiskCoverage(context, wave, progress, scale, opacity, fxConfig = UNITY_FX_TOUCH) {
	const diskCfg = fxConfig.disk;
	const radius = diskCfg.radius * evaluateUnityHermiteCurve(diskCfg.sizeKeys, progress) * scale;
	const lifecycleAlpha = evaluateNumber(diskCfg.alphaKeys, progress) * opacity;
	if (radius <= 0 || lifecycleAlpha <= 0) return;
	const resources = getCircleTextureResources();
	if (!resources) return;
	context.save();
	context.globalCompositeOperation = "source-over";
	context.translate(wave.x, wave.y);
	context.rotate(wave.diskRotation);
	context.globalAlpha = clamp01(lifecycleAlpha);
	context.shadowBlur = 0;
	context.shadowColor = "transparent";
	context.drawImage(resources.coverageCanvas, 0, 0, 512, 512, -radius, -radius, radius * 2, radius * 2);
	context.restore();
}
function resolveShardTextureFrameIndex(particle, shardCfg) {
	const frames = shardCfg.textureFrames;
	const frameCount = Array.isArray(frames) && frames.length > 0 ? frames.length : 2;
	return ((Number.isInteger(particle.textureFrame) ? particle.textureFrame : 0) % frameCount + frameCount) % frameCount;
}
function resolveShardTextureFrame(particle, shardCfg) {
	const frames = shardCfg.textureFrames;
	if (!Array.isArray(frames) || frames.length === 0) return [
		[0, -.58],
		[.52, .45],
		[-.52, .45]
	];
	return frames[resolveShardTextureFrameIndex(particle, shardCfg)];
}
function drawTriangleTextureFrame(context, canvas, frameIndex) {
	context.save();
	if (frameIndex % 2 === 1) {
		context.translate(0, 128);
		context.scale(1, -1);
	}
	context.drawImage(canvas, 0, 0);
	context.restore();
}
function resolveShardRoundness(shardCfg) {
	return clamp01(shardCfg.roundness);
}
function getRoundedTriangleCoverage(resources, roundness) {
	const key = clamp01(roundness);
	if (key <= 0) return null;
	if (!resources.roundedCoverages) resources.roundedCoverages = /* @__PURE__ */ new Map();
	if (resources.roundedCoverages.has(key)) return resources.roundedCoverages.get(key);
	if (resources.roundedCoverages.size >= 32) resources.roundedCoverages.delete(resources.roundedCoverages.keys().next().value);
	const coverage = createRoundedTriangleCoverage(key);
	resources.roundedCoverages.set(key, coverage);
	return coverage;
}
function prepareSceneRoundedTriangleCanvas(resources, materialEnergy, roundness, frameIndex) {
	const amount = clamp01(roundness);
	const shapeCoverage = getRoundedTriangleCoverage(resources, amount);
	if (!shapeCoverage) return null;
	if (!resources.roundedSceneFrames) resources.roundedSceneFrames = createLinearTintFrames(128, 2);
	if (!resources.roundedSceneFrames) return null;
	const frameSlot = (Math.trunc(frameIndex) % 2 + 2) % 2;
	const frame = resources.roundedSceneFrames[frameSlot];
	const safeMaterialEnergy = materialEnergy.map((channel) => Math.max(0, Number(channel) || 0));
	const key = [amount, ...safeMaterialEnergy].join(",");
	if (frame.key === key) return frame.canvas;
	prepareLinearTextureData(resources);
	const flipVertical = frameSlot === 1;
	const sourceRgba = resources.linearTextureRgba;
	const sourceTextureRgb = resources.linearTextureRgb;
	for (let y = 0; y < 128; y++) {
		const sourceY = flipVertical ? 127 - y : y;
		for (let x = 0; x < 128; x++) {
			const sourceIndex = sourceY * 128 + x;
			const outputOffset = (y * 128 + x) * 4;
			const targetAlpha = shapeCoverage[sourceIndex] / 255;
			const [sampleU, sampleV] = mapRoundedTriangleTextureUv((x + .5) / 128, (sourceY + .5) / 128, amount);
			const textureSupport = sampleTextureChannel(sourceRgba, 128, 4, sampleU, sampleV, 3) / 255;
			for (let channel = 0; channel < 3; channel++) {
				const supportedChannel = 1 + (sampleTextureChannel(sourceTextureRgb, 128, 3, sampleU, sampleV, channel) - 1) * clamp01(textureSupport);
				const roundedChannel = supportedChannel + (1 - supportedChannel) * amount;
				frame.image.data[outputOffset + channel] = Math.round(clamp01(roundedChannel * safeMaterialEnergy[channel]) * 255);
			}
			frame.image.data[outputOffset + 3] = Math.round(clamp01(targetAlpha) * 255);
		}
	}
	frame.context.putImageData(frame.image, 0, 0);
	frame.key = key;
	return frame.canvas;
}
function drawTexturedTriangle(context, particle, size, materialEnergy, particleAlpha, frameIndex, energyScale = 1, outputCompositing = "scene", overlayColorCompensation = "none", overlayAlphaLimit = 1, opacity = 1, roundness = 0) {
	const resources = getTriangleTextureResources();
	if (!resources) return false;
	const scaledEnergy = materialEnergy.map((channel) => channel * Math.max(0, energyScale));
	const transparentPayload = outputCompositing === "browser-overlay" || outputCompositing === "host-additive";
	const shapeCoverage = getRoundedTriangleCoverage(resources, roundness);
	const shape = shapeCoverage ? {
		coverage: shapeCoverage,
		roundness,
		useTextureAlpha: outputCompositing === "scene"
	} : null;
	let payloadAlpha = clamp01(particleAlpha);
	let textureCanvas;
	if (outputCompositing === "browser-overlay") {
		payloadAlpha = Math.min(payloadAlpha, clamp01(overlayAlphaLimit));
		const compensation = overlayColorCompensation === "bright-core" ? resolveOverlayCompensation(scaledEnergy, particleAlpha, particleAlpha, opacity) : 0;
		if (payloadAlpha > 1e-6) textureCanvas = prepareLinearTintedTextureCanvas(resources, 128, scaledEnergy, particleAlpha, particleAlpha, frameIndex, compensation, shape);
	} else if (outputCompositing === "host-additive") {
		payloadAlpha = resolveHostAdditivePayload(scaledEnergy, particleAlpha, particleAlpha)[3];
		textureCanvas = prepareLinearTintedTextureCanvas(resources, 128, scaledEnergy, particleAlpha, payloadAlpha, frameIndex, 0, shape);
	} else {
		const textureContext = resources.context;
		const scaledColor = scaledEnergy.map((channel) => Math.round(clamp01(channel) * 255));
		if (roundness > 0) textureCanvas = prepareSceneRoundedTriangleCanvas(resources, scaledEnergy, roundness, frameIndex);
		if (!textureCanvas) {
			textureContext.setTransform(1, 0, 0, 1, 0, 0);
			textureContext.globalAlpha = 1;
			textureContext.globalCompositeOperation = "source-over";
			textureContext.imageSmoothingEnabled = true;
			textureContext.clearRect(0, 0, 128, 128);
			drawTriangleTextureFrame(textureContext, resources.colorCanvas, frameIndex);
			textureContext.globalCompositeOperation = "multiply";
			textureContext.fillStyle = `rgb(${scaledColor[0]}, ${scaledColor[1]}, ${scaledColor[2]})`;
			textureContext.fillRect(0, 0, 128, 128);
			textureContext.globalCompositeOperation = "destination-in";
			drawTriangleTextureFrame(textureContext, resources.alphaCanvas, frameIndex);
			textureCanvas = resources.canvas;
		}
	}
	if (transparentPayload && (!textureCanvas || payloadAlpha <= 1e-5)) return true;
	context.save();
	context.translate(particle.x, particle.y);
	context.rotate(particle.rotation);
	context.globalAlpha = payloadAlpha;
	context.shadowColor = "transparent";
	context.shadowBlur = 0;
	context.drawImage(textureCanvas, -size * .5, -size * .5, size, size);
	context.restore();
	return true;
}
function drawTriangle(context, particle, scale, opacity, fxConfig = UNITY_FX_TOUCH, outputCompositing = "scene", overlayColorCompensation = "none", overlayAlphaLimit = 1) {
	const shardCfg = fxConfig.shards;
	const progress = clamp01(particle.ageMs / particle.lifetimeMs);
	const size = particle.size * evaluateUnityHermiteCurve(shardCfg.sizeKeys, progress) * scale;
	const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
	const materialEnergy = evaluateSrgbGradientEnergy(shardCfg.colorKeys, progress, shardCfg.hdrIntensity, shardCfg.startColor);
	const textureFrameIndex = resolveShardTextureFrameIndex(particle, shardCfg);
	const textureFrame = resolveShardTextureFrame(particle, shardCfg);
	const roundness = resolveShardRoundness(shardCfg);
	if (size <= 0 || alpha <= 0) return;
	if (drawTexturedTriangle(context, particle, size, materialEnergy, alpha, textureFrameIndex, 1, outputCompositing, overlayColorCompensation, overlayAlphaLimit, opacity, roundness)) return;
	context.save();
	context.translate(particle.x, particle.y);
	context.rotate(particle.rotation);
	context.beginPath();
	traceRoundedTrianglePath(context, textureFrame, size, shardCfg.roundness);
	if (outputCompositing === "browser-overlay") context.fillStyle = linearEnergyToOverlayCss(materialEnergy, alpha, alpha, overlayColorCompensation, overlayAlphaLimit, opacity);
	else if (outputCompositing === "host-additive") context.fillStyle = linearEnergyToHostAdditiveCss(materialEnergy, alpha, alpha);
	else context.fillStyle = linearEnergyToAdditiveCss(materialEnergy, alpha);
	context.shadowColor = "transparent";
	context.shadowBlur = 0;
	context.fill();
	context.restore();
}
function drawTriangleCoverage(context, particle, scale, opacity, fxConfig = UNITY_FX_TOUCH) {
	const shardCfg = fxConfig.shards;
	const progress = clamp01(particle.ageMs / particle.lifetimeMs);
	const size = particle.size * evaluateUnityHermiteCurve(shardCfg.sizeKeys, progress) * scale;
	const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
	const textureFrameIndex = resolveShardTextureFrameIndex(particle, shardCfg);
	const textureFrame = resolveShardTextureFrame(particle, shardCfg);
	const roundness = resolveShardRoundness(shardCfg);
	if (size <= 0 || alpha <= 0) return;
	if (drawTexturedTriangle(context, particle, size, [
		1,
		1,
		1
	], alpha, textureFrameIndex, 1, "browser-overlay", "none", 1, opacity, roundness)) return;
	context.save();
	context.translate(particle.x, particle.y);
	context.rotate(particle.rotation);
	context.beginPath();
	traceRoundedTrianglePath(context, textureFrame, size, shardCfg.roundness);
	context.fillStyle = `rgba(255, 255, 255, ${clamp01(alpha)})`;
	context.shadowColor = "transparent";
	context.shadowBlur = 0;
	context.fill();
	context.restore();
}
function drawTriangleEmission(context, particle, scale, opacity, fxConfig = UNITY_FX_TOUCH) {
	const shardCfg = fxConfig.shards;
	const bloomCfg = fxConfig.bloom;
	const progress = clamp01(particle.ageMs / particle.lifetimeMs);
	const size = particle.size * evaluateUnityHermiteCurve(shardCfg.sizeKeys, progress) * scale;
	const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
	const materialEnergy = evaluateSrgbGradientEnergy(shardCfg.colorKeys, progress, shardCfg.hdrIntensity, shardCfg.startColor);
	const textureFrameIndex = resolveShardTextureFrameIndex(particle, shardCfg);
	const textureFrame = resolveShardTextureFrame(particle, shardCfg);
	const roundness = resolveShardRoundness(shardCfg);
	if (size <= 0 || alpha <= 0) return;
	if (drawTexturedTriangle(context, particle, size, materialEnergy, alpha, textureFrameIndex, 1 / Math.max(1, bloomCfg.emissionRange), "scene", "none", 1, opacity, roundness)) return;
	context.save();
	context.translate(particle.x, particle.y);
	context.rotate(particle.rotation);
	context.beginPath();
	traceRoundedTrianglePath(context, textureFrame, size, shardCfg.roundness);
	context.fillStyle = linearEnergyToEmissionCss(materialEnergy, alpha, bloomCfg.emissionRange);
	context.fill();
	context.restore();
}
function evaluateRingAngularVelocity(angularBlend, progress, ringCfg = UNITY_FX_TOUCH.rings) {
	return lerp(evaluateUnitySmoothCurve(ringCfg.angularVelocityMinKeys, progress), evaluateUnitySmoothCurve(ringCfg.angularVelocityMaxKeys, progress), angularBlend) * ringCfg.angularVelocityMultiplier * ringCfg.rotationDirection;
}
function drawHit(context, wave, progress, scale, opacity, fxConfig, linearOutput = false, outputCompositing = "scene", overlayColorCompensation = "none", overlayAlphaLimit = 1) {
	const cfg = fxConfig.hit;
	const radius = cfg.radius * scale;
	const alpha = evaluateNumber(cfg.alphaKeys, progress) * opacity;
	const color = evaluateColor(cfg.colorKeys, progress);
	if (alpha <= 0) return;
	context.save();
	context.beginPath();
	context.arc(wave.x, wave.y, radius, 0, TAU);
	if (outputCompositing === "browser-overlay") context.fillStyle = linearEnergyToOverlayCss(colorToLinearEnergy(color, 1, true), alpha, alpha, overlayColorCompensation, overlayAlphaLimit, opacity);
	else if (outputCompositing === "host-additive") context.fillStyle = linearEnergyToHostAdditiveCss(colorToLinearEnergy(color, 1, true), alpha, alpha);
	else context.fillStyle = colorToCanvasOutputCss(color, alpha, linearOutput);
	context.fill();
	context.restore();
}
function drawFlare(context, wave, progress, scale, opacity, fxConfig, linearOutput = false, outputCompositing = "scene", overlayColorCompensation = "none", overlayAlphaLimit = 1) {
	const cfg = fxConfig.flare;
	const radius = cfg.radius * scale;
	const alpha = evaluateNumber(cfg.alphaKeys, progress) * opacity;
	const color = evaluateColor(cfg.colorKeys, progress);
	if (alpha <= 0) return;
	context.save();
	context.translate(wave.x, wave.y);
	if (outputCompositing === "browser-overlay") context.strokeStyle = linearEnergyToOverlayCss(colorToLinearEnergy(color, 1, true), alpha, alpha, overlayColorCompensation, overlayAlphaLimit, opacity);
	else if (outputCompositing === "host-additive") context.strokeStyle = linearEnergyToHostAdditiveCss(colorToLinearEnergy(color, 1, true), alpha, alpha);
	else context.strokeStyle = colorToCanvasOutputCss(color, alpha, linearOutput);
	for (let i = 0; i < cfg.rayCount; i++) {
		const angle = TAU / cfg.rayCount * i;
		const endX = Math.cos(angle) * radius;
		const endY = Math.sin(angle) * radius;
		context.beginPath();
		context.moveTo(0, 0);
		context.lineTo(endX, endY);
		context.lineWidth = 1.5 * scale;
		context.stroke();
	}
	context.restore();
}
var ClickWave = class {
	constructor(x, y, fxConfig, lastUpdateTimeMs = null) {
		this.fx = fxConfig;
		this.x = x;
		this.y = y;
		this.ageMs = 0;
		this.lastUpdateTimeMs = Number.isFinite(lastUpdateTimeMs) ? lastUpdateTimeMs : null;
		this.diskRotation = random(0, TAU);
		this.rings = [];
		const ringCfg = fxConfig.rings;
		for (let index = 0; index < ringCfg.count; index++) {
			const angularBlend = Math.random();
			this.rings.push({
				x,
				y,
				radius: random(ringCfg.radiusMin, ringCfg.radiusMax),
				rotation: random(0, TAU),
				angularBlend,
				angularVelocity: evaluateRingAngularVelocity(angularBlend, 0, ringCfg)
			});
		}
	}
	update(deltaMs) {
		const ringCfg = this.fx.rings;
		const previousAgeMs = this.ageMs;
		this.ageMs += deltaMs;
		for (const ring of this.rings) {
			const progress = (previousAgeMs + this.ageMs) * .5 / ringCfg.lifetimeMs;
			ring.angularVelocity = evaluateRingAngularVelocity(ring.angularBlend, progress, ringCfg);
			ring.rotation += ring.angularVelocity * (deltaMs / 1e3);
		}
	}
	updateTo(timeMs) {
		if (!Number.isFinite(timeMs) || !Number.isFinite(this.lastUpdateTimeMs)) return;
		const deltaMs = Math.max(0, timeMs - this.lastUpdateTimeMs);
		if (deltaMs <= 0) return;
		this.lastUpdateTimeMs = timeMs;
		this.update(deltaMs);
	}
	drawAdditiveBase(context, scale, opacity, linearOutput = false, outputCompositing = "scene", overlayColorCompensation = "none", overlayAlphaLimit = 1) {
		const hitProgress = this.ageMs / this.fx.hit.lifetimeMs;
		if (this.fx.hit.enabled && hitProgress < 1) drawHit(context, this, hitProgress, scale, opacity, this.fx, linearOutput, outputCompositing, overlayColorCompensation, overlayAlphaLimit);
		const flareProgress = this.ageMs / this.fx.flare.lifetimeMs;
		if (this.fx.flare.enabled && flareProgress < 1) drawFlare(context, this, flareProgress, scale, opacity, this.fx, linearOutput, outputCompositing, overlayColorCompensation, overlayAlphaLimit);
	}
	drawDiskLayer(context, scale, opacity, useNativeBloom = true, dpr = 1, outputCompositing = "scene", overlayColorCompensation = "none", overlayAlphaLimit = 1) {
		const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;
		if (diskProgress < 1) drawDisk(context, this, diskProgress, scale, opacity, this.fx, useNativeBloom, dpr, outputCompositing, overlayColorCompensation, overlayAlphaLimit);
	}
	drawDiskGlow(context, scale, opacity, dpr = 1) {
		const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;
		if (diskProgress < 1) drawDiskNativeGlow(context, this, diskProgress, scale, opacity, this.fx, dpr);
	}
	drawBase(context, scale, opacity, useNativeBloom = true, outputCompositing = "scene", dpr = 1, overlayColorCompensation = "none", overlayAlphaLimit = 1) {
		this.drawAdditiveBase(context, scale, opacity, false, outputCompositing, overlayColorCompensation, overlayAlphaLimit);
		this.drawDiskLayer(context, scale, opacity, useNativeBloom, dpr, outputCompositing, overlayColorCompensation, overlayAlphaLimit);
	}
	drawRings(context, scale, opacity, useNativeBloom = true, dpr = 1, outputCompositing = "scene", linearNativeGlow = false, overlayColorCompensation = "none", overlayAlphaLimit = 1) {
		const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;
		if (ringProgress < 1) {
			const ringMaterialEnergy = evaluateSrgbGradientEnergy(this.fx.rings.colorKeys, ringProgress, this.fx.rings.hdrIntensity);
			for (const ring of this.rings) drawDissolvedCircle(context, ring, ringProgress, scale, opacity, this.fx, useNativeBloom, ringMaterialEnergy, outputCompositing, linearNativeGlow, dpr, overlayColorCompensation, overlayAlphaLimit);
		}
	}
	draw(context, scale, opacity, useNativeBloom = true, outputCompositing = "scene", dpr = 1, overlayColorCompensation = "none", overlayAlphaLimit = 1) {
		this.drawBase(context, scale, opacity, useNativeBloom, outputCompositing, dpr, overlayColorCompensation, overlayAlphaLimit);
		this.drawRings(context, scale, opacity, useNativeBloom, dpr, outputCompositing, false, overlayColorCompensation, overlayAlphaLimit);
	}
	drawBloom(context, scale, opacity) {
		if (this.fx.bloom.clickEmissionScale <= 0) return;
		const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;
		if (diskProgress < 1) drawDiskEmission(context, this, diskProgress, scale, opacity, this.fx);
		const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;
		if (ringProgress < 1) {
			const ringMaterialEnergy = evaluateSrgbGradientEnergy(this.fx.rings.colorKeys, ringProgress, this.fx.rings.hdrIntensity);
			for (const ring of this.rings) drawDissolvedCircleEmission(context, ring, ringProgress, scale, opacity, this.fx, ringMaterialEnergy);
		}
	}
	drawBloomCoverage(context, scale, opacity) {
		const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;
		if (diskProgress < 1) drawDiskCoverage(context, this, diskProgress, scale, opacity, this.fx);
		const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;
		if (ringProgress >= 1) return;
		for (const ring of this.rings) drawDissolvedCircle(context, ring, ringProgress, scale, opacity, this.fx, false, [
			1,
			1,
			1
		], "browser-overlay");
	}
	appendCanvasSceneCoverage(renderer, scale, opacity) {
		const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;
		if (diskProgress >= 1) return;
		const diskCfg = this.fx.disk;
		const radius = diskCfg.radius * evaluateUnityHermiteCurve(diskCfg.sizeKeys, diskProgress) * scale;
		const particleAlpha = evaluateNumber(diskCfg.alphaKeys, diskProgress) * opacity;
		renderer.addCoverageDisk(this.x, this.y, radius, particleAlpha, this.diskRotation);
	}
	appendWebGLSceneDiskLayer(renderer, scale, opacity) {
		const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;
		if (diskProgress >= 1) return;
		const diskCfg = this.fx.disk;
		const bloomCfg = this.fx.bloom;
		const radius = diskCfg.radius * evaluateUnityHermiteCurve(diskCfg.sizeKeys, diskProgress) * scale;
		const materialEnergy = evaluateSrgbGradientEnergy(diskCfg.colorKeys, diskProgress, bloomCfg.diskEmission);
		const particleAlpha = evaluateNumber(diskCfg.alphaKeys, diskProgress);
		renderer.addAlphaBlendDisk(this.x, this.y, radius, materialEnergy, opacity, particleAlpha, this.diskRotation);
	}
	appendWebGLSceneAdditiveLayer(renderer, scale, opacity) {
		const hitProgress = this.ageMs / this.fx.hit.lifetimeMs;
		if (this.fx.hit.enabled && hitProgress < 1) {
			const hitCfg = this.fx.hit;
			const alpha = evaluateNumber(hitCfg.alphaKeys, hitProgress) * opacity;
			renderer.addSolidDisk(this.x, this.y, hitCfg.radius * scale, colorToLinearEnergy(evaluateColor(hitCfg.colorKeys, hitProgress), 1, true), alpha);
		}
		const flareProgress = this.ageMs / this.fx.flare.lifetimeMs;
		if (this.fx.flare.enabled && flareProgress < 1) {
			const flareCfg = this.fx.flare;
			const alpha = evaluateNumber(flareCfg.alphaKeys, flareProgress) * opacity;
			const color = colorToLinearEnergy(evaluateColor(flareCfg.colorKeys, flareProgress), 1, true);
			const radius = flareCfg.radius * scale;
			for (let index = 0; index < flareCfg.rayCount; index++) {
				const angle = TAU / flareCfg.rayCount * index;
				renderer.addTrailSegment({
					x: this.x,
					y: this.y
				}, {
					x: this.x + Math.cos(angle) * radius,
					y: this.y + Math.sin(angle) * radius
				}, 1.5 * scale, color, alpha);
			}
		}
		const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;
		if (ringProgress >= 1) return;
		const ringCfg = this.fx.rings;
		const ringMaterialEnergy = evaluateSrgbGradientEnergy(ringCfg.colorKeys, ringProgress, ringCfg.hdrIntensity);
		const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;
		for (const ring of this.rings) {
			const geometry = resolveRingGeometry(ring, ringProgress, scale, ringCfg);
			renderer.addDissolveRing(ring.x, ring.y, geometry.radius, geometry.width, ring.rotation, ringCfg.radialSamples, ringCfg.arcSamples, ringMaterialEnergy, opacity, geometry.threshold, ringCfg.textureUvMin, ringCfg.textureUvMax, direction);
		}
	}
	appendWebGLBloom(renderer, scale, opacity) {
		if (this.fx.bloom.clickEmissionScale <= 0) return;
		const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;
		if (diskProgress < 1) {
			const diskCfg = this.fx.disk;
			const bloomCfg = this.fx.bloom;
			const radius = diskCfg.radius * evaluateUnityHermiteCurve(diskCfg.sizeKeys, diskProgress) * scale;
			const emissionOpacity = opacity * bloomCfg.diskEmissionAlpha * bloomCfg.clickEmissionScale;
			const materialEnergy = evaluateSrgbGradientEnergy(diskCfg.colorKeys, diskProgress, bloomCfg.diskEmission);
			renderer.addDisk(this.x, this.y, radius, materialEnergy, emissionOpacity, this.diskRotation);
		}
		const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;
		if (ringProgress >= 1) return;
		const ringCfg = this.fx.rings;
		const bloomCfg = this.fx.bloom;
		const ringMaterialEnergy = evaluateSrgbGradientEnergy(ringCfg.colorKeys, ringProgress, ringCfg.hdrIntensity);
		const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;
		for (const ring of this.rings) {
			const geometry = resolveRingGeometry(ring, ringProgress, scale, ringCfg);
			renderer.addRing(ring.x, ring.y, geometry.radius, geometry.width, ring.rotation, ringCfg.radialSamples, ringCfg.arcSamples, ringMaterialEnergy, opacity * bloomCfg.ringEmissionAlpha * bloomCfg.clickEmissionScale, (angularProgress, radialProgress) => {
				return evaluateRingLuminance(direction > 0 ? angularProgress : 1 - angularProgress, radialProgress, geometry.threshold, ringCfg);
			});
		}
	}
	get dead() {
		let lifetimeMs = this.fx.disk.lifetimeMs;
		if (this.fx.hit.enabled) lifetimeMs = Math.max(lifetimeMs, this.fx.hit.lifetimeMs);
		if (this.fx.flare.enabled) lifetimeMs = Math.max(lifetimeMs, this.fx.flare.lifetimeMs);
		if (this.rings.length > 0) lifetimeMs = Math.max(lifetimeMs, this.fx.rings.lifetimeMs);
		return this.ageMs >= lifetimeMs;
	}
};
var ShardParticle = class {
	constructor(specification) {
		Object.assign(this, specification);
		this.ageMs = 0;
		this.lastUpdateTimeMs = Number.isFinite(specification.lastUpdateTimeMs) ? specification.lastUpdateTimeMs : null;
	}
	update(deltaMs) {
		const deltaSeconds = deltaMs / 1e3;
		this.ageMs += deltaMs;
		this.x += this.velocityX * deltaSeconds;
		this.y += this.velocityY * deltaSeconds;
	}
	updateTo(timeMs) {
		if (!Number.isFinite(timeMs) || !Number.isFinite(this.lastUpdateTimeMs)) return;
		const deltaMs = Math.max(0, timeMs - this.lastUpdateTimeMs);
		if (deltaMs <= 0) return;
		this.lastUpdateTimeMs = timeMs;
		this.update(deltaMs);
	}
	draw(context, scale, opacity, fxConfig = UNITY_FX_TOUCH, outputCompositing = "scene", overlayColorCompensation = "none", overlayAlphaLimit = 1) {
		drawTriangle(context, this, scale, opacity, fxConfig, outputCompositing, overlayColorCompensation, overlayAlphaLimit);
	}
	drawBloom(context, scale, opacity, fxConfig = UNITY_FX_TOUCH) {
		drawTriangleEmission(context, this, scale, opacity, fxConfig);
	}
	drawBloomCoverage(context, scale, opacity, fxConfig = UNITY_FX_TOUCH) {
		drawTriangleCoverage(context, this, scale, opacity, fxConfig);
	}
	appendWebGLScene(renderer, scale, opacity, fxConfig = UNITY_FX_TOUCH) {
		this.appendWebGLBloom(renderer, scale, opacity, fxConfig);
	}
	appendWebGLBloom(renderer, scale, opacity, fxConfig = UNITY_FX_TOUCH) {
		const shardCfg = fxConfig.shards;
		const progress = clamp01(this.ageMs / this.lifetimeMs);
		const size = this.size * evaluateUnityHermiteCurve(shardCfg.sizeKeys, progress) * scale;
		const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
		const materialEnergy = evaluateSrgbGradientEnergy(shardCfg.colorKeys, progress, shardCfg.hdrIntensity, shardCfg.startColor);
		const textureFrameIndex = resolveShardTextureFrameIndex(this, shardCfg);
		renderer.addTriangle(this.x, this.y, size, this.rotation, materialEnergy, alpha, textureFrameIndex, resolveShardRoundness(shardCfg));
	}
	get dead() {
		return this.ageMs >= this.lifetimeMs;
	}
};
function createShard(x, y, originAngle, kind, scale, shardCfg = UNITY_FX_TOUCH.shards, lastUpdateTimeMs = null, ownerId = null) {
	const isClick = kind === "click";
	const radius = (isClick ? shardCfg.clickRadius : shardCfg.trailRadius) * scale;
	const speed = (isClick ? random(shardCfg.clickSpeedMin, shardCfg.clickSpeedMax) : random(shardCfg.trailSpeedMin, shardCfg.trailSpeedMax)) * scale;
	const lifetimeMs = isClick ? random(shardCfg.clickLifetimeMinMs, shardCfg.clickLifetimeMaxMs) : random(shardCfg.trailLifetimeMinMs, shardCfg.trailLifetimeMaxMs);
	return new ShardParticle({
		kind,
		x: x + Math.cos(originAngle) * radius,
		y: y + Math.sin(originAngle) * radius,
		velocityX: Math.cos(originAngle) * speed,
		velocityY: Math.sin(originAngle) * speed,
		rotation: 0,
		textureFrame: Math.random() < .5 ? 0 : 1,
		lifetimeMs,
		size: random(shardCfg.sizeMin, shardCfg.sizeMax),
		lastUpdateTimeMs,
		ownerId
	});
}
function createTrailPoint(x, y, bornAt) {
	return {
		x,
		y,
		bornAt
	};
}
function hasVisibleTrailPoints(points) {
	for (let index = 1; index < points.length; index++) if (points[index].x !== points[index - 1].x || points[index].y !== points[index - 1].y) return true;
	return false;
}
function interpolateTrailColor(progress, trailCfg = UNITY_FX_TOUCH.trail) {
	return evaluateColor(trailCfg.gradient, progress);
}
function measureTrail(points, cacheSegmentLengths = false) {
	let totalLength = 0;
	const distances = [0];
	const segmentLengths = cacheSegmentLengths ? [0] : null;
	for (let index = 1; index < points.length; index++) {
		const segmentLength = distance(points[index - 1], points[index]);
		totalLength += segmentLength;
		distances.push(totalLength);
		if (segmentLengths) segmentLengths.push(segmentLength);
	}
	return {
		distances,
		segmentLengths,
		totalLength
	};
}
function createTrailFrameData(points, trailCfg, materialIntensity = null, cacheSegmentLengths = materialIntensity !== null) {
	const measurement = measureTrail(points, cacheSegmentLengths);
	const pointProgresses = measurement.distances.map((distanceAlongTrail) => measurement.totalLength > 0 ? distanceAlongTrail / measurement.totalLength : 0);
	const segmentProgresses = new Array(Math.max(0, points.length - 1));
	for (let index = 1; index < points.length; index++) segmentProgresses[index - 1] = measurement.totalLength > 0 ? (measurement.distances[index - 1] + measurement.distances[index]) * .5 / measurement.totalLength : 0;
	const coverageKeys = trailCfg.coverageLongitudinalKeys;
	const sharedData = {
		measurement,
		pointProgresses,
		segmentProgresses,
		pointCoverageFactors: pointProgresses.map((progress) => evaluateTrailLongitudinalCoverage(coverageKeys, progress)),
		segmentCoverageFactors: segmentProgresses.map((progress) => evaluateTrailLongitudinalCoverage(coverageKeys, progress))
	};
	if (materialIntensity === null) return sharedData;
	const pointEnergies = [];
	const pointTransverseProfiles = new Array(points.length);
	const pointCoverageProfiles = new Array(points.length);
	const segmentEnergies = [];
	const segmentMaximumEnergies = [];
	const segmentTransverseProfiles = [];
	const segmentCoverageProfiles = [];
	const textureLongitudinalKeys = trailCfg.textureLongitudinalKeys;
	if (measurement.totalLength <= 0) return {
		...sharedData,
		pointEnergies,
		pointTransverseProfiles,
		pointCoverageProfiles,
		segmentEnergies,
		segmentMaximumEnergies,
		segmentTransverseProfiles,
		segmentCoverageProfiles,
		textureLongitudinalKeys
	};
	for (let index = 0; index < points.length; index++) {
		const progress = pointProgresses[index];
		pointEnergies.push(evaluateTrailLinearEnergy(progress, trailCfg, materialIntensity, textureLongitudinalKeys));
	}
	for (let index = 1; index < points.length; index++) {
		const progress = segmentProgresses[index - 1];
		const energy = evaluateTrailLinearEnergy(progress, trailCfg, materialIntensity, textureLongitudinalKeys);
		segmentEnergies.push(energy);
		segmentMaximumEnergies.push(Math.max(...pointEnergies[index - 1], ...energy, ...pointEnergies[index]));
		segmentTransverseProfiles.push(evaluateTrailTransverseProfile(progress, trailCfg, textureLongitudinalKeys));
		segmentCoverageProfiles.push(evaluateTrailTextureCoverageProfile(progress));
	}
	return {
		...sharedData,
		pointEnergies,
		pointTransverseProfiles,
		pointCoverageProfiles,
		segmentEnergies,
		segmentMaximumEnergies,
		segmentTransverseProfiles,
		segmentCoverageProfiles,
		textureLongitudinalKeys
	};
}
function evaluateTrailLinearEnergy(progress, trailCfg, materialIntensity, textureLongitudinalKeys = trailCfg.textureLongitudinalKeys) {
	const textureIntensity = evaluateNumber(textureLongitudinalKeys, progress);
	return evaluateTrailMaterialColor(progress, trailCfg, materialIntensity).map((channel) => channel * textureIntensity);
}
function evaluateTrailMaterialColor(progress, trailCfg, materialIntensity) {
	return colorToLinearEnergy(interpolateTrailColor(progress, trailCfg), materialIntensity);
}
function evaluateTrailTransverseProfile(progress, trailCfg, textureLongitudinalKeys = trailCfg.textureLongitudinalKeys) {
	const keys = trailCfg.textureTransverseProfileKeys;
	if (!Array.isArray(keys) || keys.length === 0) return [[0, 1], [1, 1]];
	const t = clamp01(progress);
	let previous = keys[0];
	let current = keys[0];
	let localProgress = 0;
	for (let index = 1; index < keys.length; index++) {
		current = keys[index];
		if (t <= current[0]) {
			previous = keys[index - 1];
			const span = current[0] - previous[0];
			localProgress = span > 0 ? (t - previous[0]) / span : 1;
			break;
		}
		previous = current;
		localProgress = 0;
	}
	const previousCenter = evaluateNumber(textureLongitudinalKeys, previous[0]);
	const currentCenter = evaluateNumber(textureLongitudinalKeys, current[0]);
	const interpolatedCenter = evaluateNumber(textureLongitudinalKeys, t);
	const centerToEdge = previous[1].map((value, index) => {
		const absoluteEnergy = lerp(value * previousCenter, current[1][index] * currentCenter, clamp01(localProgress));
		return interpolatedCenter > 1e-7 ? clamp01(absoluteEnergy / interpolatedCenter) : 0;
	});
	const edgeIndex = centerToEdge.length - 1;
	const profile = [];
	for (let index = edgeIndex; index >= 0; index--) profile.push([(edgeIndex - index) / (edgeIndex * 2), centerToEdge[index]]);
	for (let index = 1; index <= edgeIndex; index++) profile.push([.5 + index / (edgeIndex * 2), centerToEdge[index]]);
	return profile;
}
function createTrailMesh(points, width, numCornerVertices = 0, numCapVertices = 0, segmentLengths = null) {
	const halfWidth = Math.max(0, width) * .5;
	const segments = new Array(points.length).fill(null);
	const caps = [];
	if (halfWidth <= 0) return {
		segments,
		caps
	};
	for (let index = 1; index < points.length; index++) {
		const from = points[index - 1];
		const to = points[index];
		const deltaX = to.x - from.x;
		const deltaY = to.y - from.y;
		const length = segmentLengths?.[index] ?? Math.hypot(deltaX, deltaY);
		if (length <= MIN_TRAIL_SEGMENT_LENGTH) continue;
		const tangent = {
			x: deltaX / length,
			y: deltaY / length
		};
		const normal = {
			x: -tangent.y,
			y: tangent.x
		};
		const offsetX = normal.x * halfWidth;
		const offsetY = normal.y * halfWidth;
		segments[index] = {
			index,
			from,
			to,
			length,
			tangent,
			normal,
			fromLeft: {
				x: from.x + offsetX,
				y: from.y + offsetY
			},
			fromRight: {
				x: from.x - offsetX,
				y: from.y - offsetY
			},
			toLeft: {
				x: to.x + offsetX,
				y: to.y + offsetY
			},
			toRight: {
				x: to.x - offsetX,
				y: to.y - offsetY
			}
		};
	}
	const cornerVertexCount = Math.max(0, Math.floor(numCornerVertices));
	for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex++) {
		const previous = segments[pointIndex];
		const next = segments[pointIndex + 1];
		if (!previous || !next) continue;
		const turn = previous.tangent.x * next.tangent.y - previous.tangent.y * next.tangent.x;
		const directionDot = previous.tangent.x * next.tangent.x + previous.tangent.y * next.tangent.y;
		if (Math.abs(turn) <= 1e-6) continue;
		const point = points[pointIndex];
		const innerSign = turn > 0 ? 1 : -1;
		const outerSign = -innerSign;
		const previousInner = {
			x: point.x + previous.normal.x * halfWidth * innerSign,
			y: point.y + previous.normal.y * halfWidth * innerSign
		};
		const nextInner = {
			x: point.x + next.normal.x * halfWidth * innerSign,
			y: point.y + next.normal.y * halfWidth * innerSign
		};
		const innerScale = ((nextInner.x - previousInner.x) * next.tangent.y - (nextInner.y - previousInner.y) * next.tangent.x) / turn;
		const inner = {
			x: previousInner.x + previous.tangent.x * innerScale,
			y: previousInner.y + previous.tangent.y * innerScale
		};
		const innerDistance = Math.hypot(inner.x - point.x, inner.y - point.y);
		const previousProjection = (inner.x - point.x) * previous.tangent.x + (inner.y - point.y) * previous.tangent.y;
		const nextProjection = (inner.x - point.x) * next.tangent.x + (inner.y - point.y) * next.tangent.y;
		if (!Number.isFinite(innerDistance) || innerDistance > halfWidth * MAX_TRAIL_INNER_MITER_RATIO || previousProjection < -previous.length - 1e-6 || previousProjection > 1e-6 || nextProjection < -1e-6 || nextProjection > next.length + 1e-6) continue;
		const turnAngle = Math.atan2(turn, directionDot);
		const outerStartAngle = Math.atan2(previous.normal.y * outerSign, previous.normal.x * outerSign);
		const arcStepCount = cornerVertexCount + 1;
		const outerArc = [];
		for (let step = 0; step <= arcStepCount; step++) {
			const angle = outerStartAngle + turnAngle * step / arcStepCount;
			outerArc.push({
				x: point.x + Math.cos(angle) * halfWidth,
				y: point.y + Math.sin(angle) * halfWidth
			});
		}
		if (innerSign > 0) {
			previous.toLeft = inner;
			next.fromLeft = inner;
			previous.toRight = outerArc[0];
			next.fromRight = outerArc.at(-1);
		} else {
			previous.toRight = inner;
			next.fromRight = inner;
			previous.toLeft = outerArc[0];
			next.fromLeft = outerArc.at(-1);
		}
		previous.endJoin = {
			nextSegmentIndex: next.index,
			inner,
			innerSide: innerSign > 0 ? "left" : "right",
			outerArc
		};
	}
	if (Math.floor(numCapVertices) > 0) {
		const first = segments.find((segment) => segment);
		let last = null;
		for (let index = segments.length - 1; index >= 1; index--) if (segments[index]) {
			last = segments[index];
			break;
		}
		if (first) caps.push({
			position: "start",
			segmentIndex: first.index,
			pointIndex: first.index - 1,
			points: [
				first.fromLeft,
				first.fromRight,
				{
					x: first.from.x - first.tangent.x * halfWidth,
					y: first.from.y - first.tangent.y * halfWidth
				}
			]
		});
		if (last) caps.push({
			position: "end",
			segmentIndex: last.index,
			pointIndex: last.index,
			points: [
				last.toLeft,
				{
					x: last.to.x + last.tangent.x * halfWidth,
					y: last.to.y + last.tangent.y * halfWidth
				},
				last.toRight
			]
		});
	}
	return {
		segments,
		caps
	};
}
function getTrailMesh(trailData, points, width, trailCfg) {
	if (!trailData.meshCache) trailData.meshCache = /* @__PURE__ */ new Map();
	const cornerVertices = Math.max(0, Math.floor(trailCfg.numCornerVertices ?? 0));
	const capVertices = Math.max(0, Math.floor(trailCfg.numCapVertices ?? 0));
	const cacheKey = `${width}:${cornerVertices}:${capVertices}`;
	if (!trailData.meshCache.has(cacheKey)) trailData.meshCache.set(cacheKey, createTrailMesh(points, width, cornerVertices, capVertices, trailData.measurement.segmentLengths));
	return trailData.meshCache.get(cacheKey);
}
function resolveTrailTransverseProfile(profile) {
	return Array.isArray(profile) && profile.length >= 2 ? profile : [[0, 1], [1, 1]];
}
function createTrailCrossSectionGradient(context, from, to, transverseProfile, colorAtIntensity) {
	const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
	for (const [position, intensity] of resolveTrailTransverseProfile(transverseProfile)) gradient.addColorStop(clamp01(position), colorAtIntensity(intensity, position));
	return gradient;
}
function fillTrailMeshSegment(context, segment, endJoin, transverseProfile, colorAtIntensity) {
	const gradient = createTrailCrossSectionGradient(context, segment.fromLeft, segment.fromRight, transverseProfile, colorAtIntensity);
	context.beginPath();
	context.moveTo(segment.fromLeft.x, segment.fromLeft.y);
	if (!endJoin) {
		context.lineTo(segment.toLeft.x, segment.toLeft.y);
		context.lineTo(segment.toRight.x, segment.toRight.y);
	} else if (endJoin.innerSide === "left") {
		context.lineTo(endJoin.inner.x, endJoin.inner.y);
		for (let index = endJoin.outerArc.length - 1; index >= 0; index--) {
			const point = endJoin.outerArc[index];
			context.lineTo(point.x, point.y);
		}
	} else {
		for (const point of endJoin.outerArc) context.lineTo(point.x, point.y);
		context.lineTo(endJoin.inner.x, endJoin.inner.y);
	}
	context.lineTo(segment.fromRight.x, segment.fromRight.y);
	context.closePath();
	context.fillStyle = gradient;
	context.fill();
}
function fillTrailMeshCap(context, cap, transverseProfile, colorAtIntensity) {
	const left = cap.points[0];
	const gradient = createTrailCrossSectionGradient(context, left, cap.position === "start" ? cap.points[1] : cap.points[2], transverseProfile, colorAtIntensity);
	context.beginPath();
	context.moveTo(cap.points[0].x, cap.points[0].y);
	context.lineTo(cap.points[1].x, cap.points[1].y);
	context.lineTo(cap.points[2].x, cap.points[2].y);
	context.closePath();
	context.fillStyle = gradient;
	context.fill();
}
function resolveTrailPointEnergy(trailData, pointIndex, trailCfg, materialIntensity) {
	if (trailData.pointEnergies?.[pointIndex]) return trailData.pointEnergies[pointIndex];
	return evaluateTrailLinearEnergy(trailData.measurement.distances[pointIndex] / trailData.measurement.totalLength, trailCfg, materialIntensity);
}
function resolveTrailPointTransverseProfile(trailData, pointIndex, trailCfg) {
	const profiles = trailData.pointTransverseProfiles;
	if (profiles?.[pointIndex]) return profiles[pointIndex];
	const profile = evaluateTrailTransverseProfile(trailData.measurement.distances[pointIndex] / trailData.measurement.totalLength, trailCfg, trailData.textureLongitudinalKeys);
	if (profiles) profiles[pointIndex] = profile;
	return profile;
}
function resolveTrailPointCoverageFactor(trailData, pointIndex, trailCfg) {
	const cached = trailData.pointCoverageFactors?.[pointIndex];
	if (Number.isFinite(cached)) return cached;
	const progress = trailData.pointProgresses?.[pointIndex] ?? trailData.measurement.distances[pointIndex] / trailData.measurement.totalLength;
	return evaluateTrailLongitudinalCoverage(trailCfg.coverageLongitudinalKeys, progress);
}
function resolveTrailPointCoverageProfile(trailData, pointIndex) {
	const profiles = trailData.pointCoverageProfiles;
	if (profiles?.[pointIndex]) return profiles[pointIndex];
	const profile = evaluateTrailTextureCoverageProfile(trailData.pointProgresses?.[pointIndex] ?? trailData.measurement.distances[pointIndex] / trailData.measurement.totalLength);
	if (profiles) profiles[pointIndex] = profile;
	return profile;
}
function drawTrailLayer(context, points, trailData, scale, opacity, trailCfg, layer, segmentStart = 1, segmentEnd = points.length - 1) {
	const measurement = trailData.measurement;
	if (measurement.totalLength <= 0) return;
	context.save();
	context.shadowBlur = 0;
	context.shadowColor = "transparent";
	const mesh = getTrailMesh(trailData, points, layer.scaledWidth ?? layer.width * scale, trailCfg);
	const firstSegment = clamp(Math.floor(segmentStart), 1, points.length - 1);
	const lastSegment = clamp(Math.floor(segmentEnd), firstSegment, points.length - 1);
	const resolveCss = layer.colorAtIntensity ?? ((color, intensity, textureCoverage, longitudinalCoverage) => {
		const contribution = layer.alpha * opacity * intensity;
		const coverage = layer.alpha * opacity * textureCoverage * longitudinalCoverage;
		return layer.outputCompositing === "browser-overlay" ? linearEnergyToOverlayCss(color, contribution, coverage, layer.overlayColorCompensation, layer.overlayAlphaLimit, layer.globalOpacity ?? opacity) : layer.outputCompositing === "host-additive" ? linearEnergyToHostAdditiveCss(color, contribution, coverage) : linearEnergyToAdditiveCss(color, contribution);
	});
	for (let index = firstSegment; index <= lastSegment; index++) {
		const segment = mesh.segments[index];
		if (!segment) continue;
		const progress = (measurement.distances[index - 1] + measurement.distances[index]) * .5 / measurement.totalLength;
		const color = trailData.segmentEnergies?.[index - 1] ?? evaluateTrailLinearEnergy(progress, trailCfg, layer.materialIntensity);
		const transverseProfile = trailData.segmentTransverseProfiles?.[index - 1] ?? evaluateTrailTransverseProfile(progress, trailCfg);
		const coverageProfile = trailData.segmentCoverageProfiles?.[index - 1] ?? evaluateTrailTextureCoverageProfile(progress);
		const longitudinalCoverage = trailData.segmentCoverageFactors?.[index - 1] ?? evaluateTrailLongitudinalCoverage(trailCfg.coverageLongitudinalKeys, progress);
		fillTrailMeshSegment(context, segment, segment.endJoin?.nextSegmentIndex <= lastSegment ? segment.endJoin : null, transverseProfile, (intensity, position) => resolveCss(color, intensity, evaluateNumber(coverageProfile, position), longitudinalCoverage));
	}
	for (const cap of mesh.caps) {
		if (cap.segmentIndex < firstSegment || cap.segmentIndex > lastSegment) continue;
		const color = resolveTrailPointEnergy(trailData, cap.pointIndex, trailCfg, layer.materialIntensity);
		const transverseProfile = resolveTrailPointTransverseProfile(trailData, cap.pointIndex, trailCfg);
		const coverageProfile = resolveTrailPointCoverageProfile(trailData, cap.pointIndex);
		const longitudinalCoverage = resolveTrailPointCoverageFactor(trailData, cap.pointIndex, trailCfg);
		fillTrailMeshCap(context, cap, transverseProfile, (intensity, position) => resolveCss(color, intensity, evaluateNumber(coverageProfile, position), longitudinalCoverage));
	}
	context.restore();
}
function hasPositiveTrailEnergy(energy) {
	return Array.isArray(energy) && energy.some((channel) => channel > 0);
}
function hasDrawableNativeTrailEnergy(trailData, trailCfg) {
	const segmentLengths = trailData.measurement.segmentLengths;
	const segmentEnergies = trailData.segmentEnergies;
	if (!segmentLengths || !Array.isArray(segmentEnergies) || segmentLengths.length !== segmentEnergies.length + 1) return true;
	let startCapPointIndex = null;
	let endCapPointIndex = null;
	for (let index = 1; index < segmentLengths.length; index++) {
		if (segmentLengths[index] <= MIN_TRAIL_SEGMENT_LENGTH) continue;
		if (startCapPointIndex === null) startCapPointIndex = index - 1;
		endCapPointIndex = index;
		const energy = segmentEnergies[index - 1];
		if (!Array.isArray(energy) || hasPositiveTrailEnergy(energy)) return true;
	}
	if (startCapPointIndex === null || !(Math.floor(trailCfg.numCapVertices ?? 0) > 0)) return false;
	const startCapEnergy = trailData.pointEnergies?.[startCapPointIndex];
	const endCapEnergy = trailData.pointEnergies?.[endCapPointIndex];
	if (!Array.isArray(startCapEnergy) || !Array.isArray(endCapEnergy)) return true;
	return hasPositiveTrailEnergy(startCapEnergy) || hasPositiveTrailEnergy(endCapEnergy);
}
/**
* 将按真实弧长着色的发射带绘入局部缓冲，再整体模糊一次。
* 不能使用首尾弦线性渐变：回环轨迹会把暗尾投影到高亮区，产生异常光晕。
*/
function drawNativeTrailBloom(context, points, trailData, scale, opacity, trailCfg, bloomCfg, surface, outputCompositing = "scene", overlayColorCompensation = "none", overlayAlphaLimit = 1) {
	if (trailData.measurement.totalLength <= 0 || opacity <= 0 || bloomCfg.trailAlpha <= 0 || bloomCfg.trailEmission <= 0 || typeof context.filter !== "string" || !surface?.context || !hasDrawableNativeTrailEnergy(trailData, trailCfg)) return;
	const firstVisibleSegmentOffset = trailData.segmentEnergies.findIndex((energy) => energy.some((channel) => channel !== 0));
	const firstVisibleSegment = trailData.pointEnergies[0]?.every((channel) => channel === 0) === true && firstVisibleSegmentOffset >= 0 ? firstVisibleSegmentOffset + 1 : 1;
	const blurRadius = Math.max(0, trailCfg.outerGlowWidth * scale);
	const halfWidth = Math.max(.5, trailCfg.geometryWidth * scale * .5);
	const margin = Math.ceil(blurRadius * 3 + halfWidth + 2);
	let minimumX = Infinity;
	let minimumY = Infinity;
	let maximumX = -Infinity;
	let maximumY = -Infinity;
	const firstBoundPointIndex = firstVisibleSegment - 1;
	for (let index = firstBoundPointIndex; index < points.length; index++) {
		const point = points[index];
		minimumX = Math.min(minimumX, point.x);
		minimumY = Math.min(minimumY, point.y);
		maximumX = Math.max(maximumX, point.x);
		maximumY = Math.max(maximumY, point.y);
	}
	const originX = Math.floor(minimumX - margin);
	const originY = Math.floor(minimumY - margin);
	const regionWidth = Math.max(1, Math.ceil(maximumX + margin) - originX);
	const regionHeight = Math.max(1, Math.ceil(maximumY + margin) - originY);
	const dpr = Math.max(1, surface.dpr || 1);
	const requiredWidth = Math.max(1, Math.ceil(regionWidth * dpr));
	const requiredHeight = Math.max(1, Math.ceil(regionHeight * dpr));
	const canvas = surface.canvas;
	const bufferContext = surface.context;
	const capacityWidth = Math.max(canvas.width, 2 ** Math.ceil(Math.log2(requiredWidth)));
	const capacityHeight = Math.max(canvas.height, 2 ** Math.ceil(Math.log2(requiredHeight)));
	if (canvas.width !== capacityWidth || canvas.height !== capacityHeight) {
		canvas.width = capacityWidth;
		canvas.height = capacityHeight;
	}
	bufferContext.setTransform(1, 0, 0, 1, 0, 0);
	bufferContext.clearRect(0, 0, requiredWidth, requiredHeight);
	bufferContext.setTransform(dpr, 0, 0, dpr, -originX * dpr, -originY * dpr);
	bufferContext.globalCompositeOperation = "lighter";
	bufferContext.filter = "none";
	drawTrailLayer(bufferContext, points, trailData, scale, opacity, trailCfg, {
		width: trailCfg.geometryWidth,
		materialIntensity: bloomCfg.trailEmission,
		colorAtIntensity: (color, intensity, textureCoverage, longitudinalCoverage) => linearEnergyToNativeTrailBloomCss(color, opacity, intensity, bloomCfg, outputCompositing, opacity * textureCoverage * longitudinalCoverage, overlayColorCompensation, overlayAlphaLimit)
	}, firstVisibleSegment);
	context.save();
	context.filter = `blur(${blurRadius * dpr}px)`;
	context.shadowBlur = 0;
	context.shadowColor = "transparent";
	context.drawImage(canvas, 0, 0, requiredWidth, requiredHeight, originX, originY, regionWidth, regionHeight);
	context.restore();
}
/**
* main 分支风格的拖尾层：普通 Canvas 使用 sRGB，Final Pass 使用线性能量。
* layer.color 为固定颜色时整条一次描边（round cap）；
* 无 color 时按路径距离采样 gradient（butt cap 逐段）。
*/
function drawTrail(context, points, scale, opacity, fxConfig = UNITY_FX_TOUCH, useNativeBloom = true, nativeBloomSurface = null, sharedTrailData = null, linearOutput = false, outputCompositing = "scene", overlayColorCompensation = "none", overlayAlphaLimit = 1) {
	const trailCfg = fxConfig.trail;
	const bloomCfg = fxConfig.bloom;
	const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1);
	const trailData = sharedTrailData ?? createTrailFrameData(points, trailCfg, bloomCfg.trailEmission);
	if (useNativeBloom) drawNativeTrailBloom(context, points, trailData, scale, trailOpacity, trailCfg, bloomCfg, nativeBloomSurface, outputCompositing, overlayColorCompensation, overlayAlphaLimit);
	drawTrailLayer(context, points, trailData, scale, trailOpacity, trailCfg, {
		width: trailCfg.width,
		alpha: 1,
		materialIntensity: bloomCfg.trailEmission,
		outputCompositing,
		overlayColorCompensation,
		overlayAlphaLimit
	});
}
function drawTrailCoverage(context, points, scale, opacity, fxConfig = UNITY_FX_TOUCH, sharedTrailData = null, segmentStart = 1, segmentEnd = points.length - 1) {
	const trailCfg = fxConfig.trail;
	const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1);
	const trailData = sharedTrailData ?? createTrailFrameData(points, trailCfg, 1);
	if (trailData.measurement.totalLength <= 0 || trailOpacity <= 0) return;
	drawTrailLayer(context, points, trailData, scale, 1, trailCfg, {
		width: trailCfg.width,
		colorAtIntensity: (_color, _intensity, textureCoverage, longitudinalCoverage) => `rgba(255, 255, 255, ${clamp01(trailOpacity * textureCoverage * longitudinalCoverage)})`
	}, segmentStart, segmentEnd);
}
function drawTrailEmission(context, points, scale, opacity, fxConfig = UNITY_FX_TOUCH, sharedTrailData = null, segmentStart = 1, segmentEnd = points.length - 1) {
	const trailCfg = fxConfig.trail;
	const bloomCfg = fxConfig.bloom;
	const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1) * bloomCfg.trailEmissionAlpha;
	const trailData = sharedTrailData ?? createTrailFrameData(points, trailCfg, bloomCfg.trailEmission);
	if (trailData.measurement.totalLength <= 0 || trailOpacity <= 0) return;
	const width = Math.max(.5, trailCfg.geometryWidth * scale * bloomCfg.trailCoverageScale);
	const firstSegment = clamp(Math.floor(segmentStart), 1, points.length - 1);
	const lastSegment = clamp(Math.floor(segmentEnd), firstSegment, points.length - 1);
	drawTrailLayer(context, points, trailData, scale, 1, trailCfg, {
		scaledWidth: width,
		alpha: 1,
		materialIntensity: bloomCfg.trailEmission,
		colorAtIntensity: (color, intensity) => linearEnergyToEmissionCss(color, trailOpacity * intensity, bloomCfg.emissionRange)
	}, firstSegment, lastSegment);
}
function createTexturedTrailVertex(point, u, v) {
	return {
		x: point.x,
		y: point.y,
		u,
		v
	};
}
function appendTexturedTrailMeshSegment(renderer, segment, fromSample, toSample, opacity) {
	const fromLeft = createTexturedTrailVertex(segment.fromLeft, fromSample.u, 1);
	const fromRight = createTexturedTrailVertex(segment.fromRight, fromSample.u, 0);
	const toLeft = createTexturedTrailVertex(segment.toLeft, toSample.u, 1);
	const toRight = createTexturedTrailVertex(segment.toRight, toSample.u, 0);
	renderer.addTexturedTrailTriangle(fromLeft, toLeft, toRight, [
		fromSample.color,
		toSample.color,
		toSample.color
	], opacity, [
		fromSample.coverage,
		toSample.coverage,
		toSample.coverage
	]);
	renderer.addTexturedTrailTriangle(fromLeft, toRight, fromRight, [
		fromSample.color,
		toSample.color,
		fromSample.color
	], opacity, [
		fromSample.coverage,
		toSample.coverage,
		fromSample.coverage
	]);
}
function appendTexturedTrailMeshJoin(renderer, join, sample, opacity) {
	const innerV = join.innerSide === "left" ? 1 : 0;
	const outerV = 1 - innerV;
	const inner = createTexturedTrailVertex(join.inner, sample.u, innerV);
	for (let arcIndex = 1; arcIndex < join.outerArc.length; arcIndex++) {
		const previousOuter = createTexturedTrailVertex(join.outerArc[arcIndex - 1], sample.u, outerV);
		const nextOuter = createTexturedTrailVertex(join.outerArc[arcIndex], sample.u, outerV);
		renderer.addTexturedTrailTriangle(inner, previousOuter, nextOuter, sample.color, opacity, sample.coverage);
	}
}
function appendTexturedTrailMeshCaps(renderer, mesh, visibleSegments, pointSamples, opacity) {
	for (const cap of mesh.caps) {
		if (!visibleSegments.has(cap.segmentIndex)) continue;
		const sample = pointSamples[cap.pointIndex];
		const vCoordinates = cap.position === "start" ? [
			1,
			0,
			.5
		] : [
			1,
			.5,
			0
		];
		const vertices = cap.points.map((point, index) => createTexturedTrailVertex(point, sample.u, vCoordinates[index]));
		renderer.addTexturedTrailTriangle(vertices[0], vertices[1], vertices[2], sample.color, opacity, sample.coverage);
	}
}
function appendTexturedTrailMeshJoins(renderer, mesh, visibleSegments, pointSamples, opacity) {
	for (let segmentIndex = 1; segmentIndex < mesh.segments.length; segmentIndex++) {
		const join = mesh.segments[segmentIndex]?.endJoin;
		if (!join || !visibleSegments.has(segmentIndex) || !visibleSegments.has(join.nextSegmentIndex)) continue;
		appendTexturedTrailMeshJoin(renderer, join, pointSamples[segmentIndex], opacity);
	}
}
function appendTrailWebGLScene(renderer, points, scale, opacity, fxConfig = UNITY_FX_TOUCH, sharedTrailData = null) {
	const trailCfg = fxConfig.trail;
	const bloomCfg = fxConfig.bloom;
	const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1);
	const trailData = sharedTrailData ?? createTrailFrameData(points, trailCfg, bloomCfg.trailEmission);
	const width = trailCfg.width * scale;
	if (trailData.measurement.totalLength <= 0 || trailOpacity <= 0 || width <= 0) return;
	const mesh = getTrailMesh(trailData, points, width, trailCfg);
	const visibleSegments = /* @__PURE__ */ new Set();
	const pointSamples = new Array(points.length);
	for (let index = 0; index < points.length; index++) {
		const progress = trailData.pointProgresses?.[index] ?? trailData.measurement.distances[index] / trailData.measurement.totalLength;
		pointSamples[index] = {
			u: 1 - progress,
			color: evaluateTrailMaterialColor(progress, trailCfg, bloomCfg.trailEmission),
			coverage: resolveTrailPointCoverageFactor(trailData, index, trailCfg)
		};
	}
	for (let index = 1; index < points.length; index++) {
		const segment = mesh.segments[index];
		if (!segment) continue;
		visibleSegments.add(index);
		appendTexturedTrailMeshSegment(renderer, segment, pointSamples[index - 1], pointSamples[index], trailOpacity);
	}
	appendTexturedTrailMeshJoins(renderer, mesh, visibleSegments, pointSamples, trailOpacity);
	appendTexturedTrailMeshCaps(renderer, mesh, visibleSegments, pointSamples, trailOpacity);
}
var BAClickFX = class {
	/**
	* @param {object} [options]
	* @param {string|HTMLElement|OffscreenCanvas} [options.target]
	* @param {number} [options.scale]
	* @param {number} [options.opacity]
	* @param {string} [options.themeColor]
	* @param {'hue-only'|'relative-oklch'} [options.themeColorMode]
	* @param {boolean} [options.clickEnabled]
	* @param {boolean} [options.trailEnabled]
	* @param {boolean} [options.trailAlways]
	* @param {'dom'|'manual'} [options.inputSource]
	* @param {number} [options.inputSamplingRate]
	* @param {number} [options.clickTimeScale]
	* @param {number} [options.trailTimeScale]
	* @param {'scene'|'browser-overlay'} [options.outputCompositing]
	* @param {'coverage'|'visual-max'} [options.overlayAlphaPolicy]
	* @param {'none'|'bright-core'} [options.overlayColorCompensation]
	* @param {number} [options.overlayAlphaLimit]
	* @param {'source-over'|'screen'|'plus-lighter'} [options.hostCompositing]
	* @param {'dom-backdrop'|'transparent-window'|'native'} [options.hostCompositingSurface]
	* @param {'canvas2d'|'webgl2'|'webgpu'|'auto'} [options.effectBackend]
	* @param {boolean} [options.webgpuPreferHdr]
	* @param {number} [options.webgpuHdrPeak]
	* @param {number} [options.webgpuHdrBrightness]
	* @param {number} [options.webgpuHdrColorPreservation]
	* @param {number} [options.webgpuHdrWhiteCore]
	* @param {number} [options.webgpuHdrWhiteStart]
	* @param {number} [options.webgpuHdrWhiteEnd]
	* @param {'auto'|'software'|'webgl2'|'native'} [options.bloomBackend]
	* @param {boolean} [options.isolatedCompositing]
	* @param {number} [options.lightBackgroundContrastAlpha]
	* @param {number} [options.maxDpr]
	* @param {string} [options.touchAction]
	* @param {(event: PointerEvent) => boolean} [options.inputFilter]
	*/
	constructor(options = {}) {
		assertConfigOverrides(options, { allowInstanceOptions: true });
		const hasDom = typeof document !== "undefined" && typeof window !== "undefined";
		if (!hasDom && !(typeof OffscreenCanvas !== "undefined")) throw new Error("BAClickFX 需要浏览器 DOM 或 Web Worker (OffscreenCanvas) 环境");
		if (!hasDom && !isOffscreenCanvas(options.target)) throw new Error("BAClickFX 在 Worker 中需要显式传入 OffscreenCanvas target");
		const { target: _target, inputFilter: _inputFilter, ...configOptions } = options;
		this.config = createConfig(configOptions);
		this.inputFilter = typeof options.inputFilter === "function" ? options.inputFilter : null;
		this.host = resolveTarget(options.target);
		this.ownsCanvas = !isCanvas(this.host);
		if (!this.ownsCanvas) this.config.isolatedCompositing = false;
		this.canvas = isCanvas(this.host) ? this.host : createCanvas();
		this.contrastCanvas = this.ownsCanvas ? createCanvas() : null;
		this.webglBloomCanvas = null;
		this.webglBloomRenderer = null;
		this.webglBloomUnavailable = false;
		this.webglBloomVisible = false;
		this.webglEffectCanvas = null;
		this.webglEffectRenderer = null;
		this.webglEffectUnavailable = false;
		this.webglEffectVisible = false;
		this.webgpuEffectCanvas = null;
		this.webgpuEffectRenderer = null;
		this.webgpuEffectUnavailable = false;
		this.webgpuEffectVisible = false;
		this.canvasSceneCanvas = null;
		this.canvasSceneRenderer = null;
		this.canvasSceneUnavailable = false;
		this.canvasSceneVisible = false;
		this.compositingReferenceSource = null;
		this.compositingReferenceFit = "cover";
		this.compositingMountPending = false;
		this.hostCompositingState = this._resolveHostCompositingState();
		if (!this.canvas) throw new Error("BAClickFX 找不到 target");
		if (this.ownsCanvas) {
			const parent = this.host ?? document.body;
			this.overlayMountParent = parent;
			this.overlayRoot = createOverlayRoot(!this.host);
			setOverlayStyle(this.canvas, false, "2147483646", "");
			setOverlayStyle(this.contrastCanvas, false, "2147483647", "darken");
			this._applyCompositingMount();
		} else {
			this.overlayMountParent = null;
			this.overlayRoot = null;
			this.overlayParent = null;
			this._applyCompositingMount();
		}
		if (this.canvas.style) this.canvas.style.touchAction = this.config.touchAction;
		const isDirectOffscreen = isOffscreenCanvas(this.canvas);
		const requiresCanvas2D = !isDirectOffscreen || this.config.effectBackend === "canvas2d";
		this.context = requiresCanvas2D ? this.canvas.getContext("2d") : null;
		this.contrastContext = this.contrastCanvas?.getContext("2d") ?? null;
		if (!this.context && requiresCanvas2D) throw new Error("BAClickFX 无法创建 Canvas 2D 上下文");
		this.bloomRenderer = new SoftwareBloomRenderer(() => createCanvas());
		this.bloomRenderers = [this.bloomRenderer];
		this.resolvedEffectBackend = this._getRequestedEffectBackendState();
		this.resolvedBloomBackend = this._getRequestedBloomBackendState();
		this.softwareBloomFrameStats = {
			regionCount: 0,
			processedSourcePixels: 0,
			combinedBoundsPixels: 0
		};
		this.lastSoftwareBloomFrame = null;
		this.canvasBloomTransportCanvas = null;
		this.canvasBloomTransportContext = null;
		this.canvasNativeSceneAlphaSnapshot = null;
		this.webglBloomFrameStats = {
			available: false,
			vertexCount: 0,
			levelCount: 0,
			bloomPixels: 0
		};
		this.nativeTrailBloomSurface = void 0;
		this.width = 0;
		this.height = 0;
		this.dpr = 1;
		this.fxConfig = structuredClone(UNITY_FX_TOUCH);
		this._themeHueShift = computeThemeHueShift(this.config.themeColor);
		this._relativeOklchTheme = this.config.themeColorMode === "relative-oklch" ? createRelativeOklchTheme(this.config.themeColor) : null;
		this.waves = [];
		this.shards = [];
		this.trailStrokes = [];
		this.currentTrailStroke = null;
		this.activeTrailOwnerId = null;
		this.nextTrailOwnerId = 1;
		this.trailShardCounts = /* @__PURE__ */ new Map();
		this.activePointerId = null;
		this.activePointerSource = null;
		this.fallbackTouchPointerId = null;
		this.lastPointerPosition = null;
		this.lastPointerTime = 0;
		this.lastInputSampleSourceTime = null;
		this.trailDistanceSinceShard = 0;
		this.touchGestureStarts = /* @__PURE__ */ new Map();
		this.touchPointerFilterResults = [];
		this.closedShadowPointerDecisions = /* @__PURE__ */ new WeakMap();
		this.usesTouchInputFallback = shouldUseTouchInputFallback();
		this.touchActionListenersAttached = false;
		this.closedShadowTouchListenersAttached = false;
		const initialTimeSource = performance.now();
		this.clickTimeMs = 0;
		this.trailTimeMs = 0;
		this.lastClickTimeSource = initialTimeSource;
		this.lastTrailTimeSource = initialTimeSource;
		this.animationFrame = null;
		this.lastFrameTime = null;
		this.renderingFrame = false;
		this.paused = false;
		this.destroyed = false;
		this.domPointerListenersAttached = false;
		this._onResize = () => this._resize();
		this._onPointerDown = this._handlePointerDown.bind(this);
		this._onPointerMove = this._handlePointerMove.bind(this);
		this._onPointerUp = this._handlePointerUp.bind(this);
		this._onPointerCancel = this._handlePointerCancel.bind(this);
		this._onClosedShadowPointerDown = this._handleClosedShadowPointerDown.bind(this);
		this._onTouchStart = this._handleTouchStart.bind(this);
		this._onTouchMove = this._handleTouchMove.bind(this);
		this._onTouchEnd = this._handleTouchEnd.bind(this);
		this._onBlur = this._cancelPointer.bind(this);
		this._onFrame = this._renderFrame.bind(this);
		this._onWebGLContextLost = this._handleWebGLContextLost.bind(this);
		this._onWebGLContextRestored = this._handleWebGLContextRestored.bind(this);
		this._onWebGLEffectContextLost = this._handleWebGLEffectContextLost.bind(this);
		this._onWebGLEffectContextRestored = this._handleWebGLEffectContextRestored.bind(this);
		this._onCanvasSceneContextLost = this._handleCanvasSceneContextLost.bind(this);
		this._onCanvasSceneContextRestored = this._handleCanvasSceneContextRestored.bind(this);
		this._resize();
		if (isDirectOffscreen && !requiresCanvas2D && !this._prepareWebGLEffectBackend()) {
			this.context = this.canvas.getContext("2d");
			if (!this.context) {
				if (this.animationFrame !== null) {
					cancelRenderFrame(this.animationFrame);
					this.animationFrame = null;
				}
				throw new Error("BAClickFX 无法在 OffscreenCanvas 上初始化 WebGL2；请使用新的画布并显式选择 Canvas2D");
			}
			this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		}
		this._directOffscreenContextType = isDirectOffscreen ? this.context ? "2d" : "webgl2" : null;
		if (typeof window !== "undefined") window.addEventListener("resize", this._onResize);
		if (this.config.inputSource === "dom" && typeof window !== "undefined") this._attachDomPointerListeners();
		if (typeof window !== "undefined") window.addEventListener("blur", this._onBlur);
		if (this.host && !isCanvas(this.host) && typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(this._onResize);
			this.resizeObserver.observe(this.host);
		} else this.resizeObserver = null;
	}
	_attachDomPointerListeners() {
		if (this.domPointerListenersAttached) return;
		if (!this.usesTouchInputFallback) {
			window.addEventListener("pointerdown", this._onPointerDown, { capture: true });
			window.addEventListener("pointermove", this._onPointerMove, {
				capture: true,
				passive: true
			});
			window.addEventListener("pointerup", this._onPointerUp, { capture: true });
			window.addEventListener("pointercancel", this._onPointerCancel, { capture: true });
		}
		this.domPointerListenersAttached = true;
		this._syncTouchActionListeners();
	}
	_attachTouchActionListeners() {
		if (this.touchActionListenersAttached) return;
		window.addEventListener("touchstart", this._onTouchStart, {
			capture: true,
			passive: false
		});
		window.addEventListener("touchmove", this._onTouchMove, {
			capture: true,
			passive: false
		});
		window.addEventListener("touchend", this._onTouchEnd, {
			capture: true,
			passive: true
		});
		window.addEventListener("touchcancel", this._onTouchEnd, {
			capture: true,
			passive: true
		});
		const hostInClosedShadowRoot = this._isHostInClosedShadowRoot();
		if (hostInClosedShadowRoot && !this.usesTouchInputFallback) this.host.addEventListener("pointerdown", this._onClosedShadowPointerDown, { capture: true });
		if (hostInClosedShadowRoot && typeof this.host?.addEventListener === "function") {
			this.host.addEventListener("touchstart", this._onTouchStart, {
				capture: true,
				passive: false
			});
			this.host.addEventListener("touchmove", this._onTouchMove, {
				capture: true,
				passive: false
			});
			this.host.addEventListener("touchend", this._onTouchEnd, {
				capture: true,
				passive: true
			});
			this.host.addEventListener("touchcancel", this._onTouchEnd, {
				capture: true,
				passive: true
			});
			this.closedShadowTouchListenersAttached = true;
		}
		this.touchActionListenersAttached = true;
	}
	_detachTouchActionListeners() {
		if (!this.touchActionListenersAttached) {
			this.touchGestureStarts.clear();
			this.touchPointerFilterResults.length = 0;
			this.closedShadowPointerDecisions = /* @__PURE__ */ new WeakMap();
			this.closedShadowTouchListenersAttached = false;
			return;
		}
		if (typeof window !== "undefined") {
			window.removeEventListener("touchstart", this._onTouchStart, true);
			window.removeEventListener("touchmove", this._onTouchMove, true);
			window.removeEventListener("touchend", this._onTouchEnd, true);
			window.removeEventListener("touchcancel", this._onTouchEnd, true);
		}
		if (this.closedShadowTouchListenersAttached) {
			this.host?.removeEventListener?.("touchstart", this._onTouchStart, true);
			this.host?.removeEventListener?.("touchmove", this._onTouchMove, true);
			this.host?.removeEventListener?.("touchend", this._onTouchEnd, true);
			this.host?.removeEventListener?.("touchcancel", this._onTouchEnd, true);
			this.closedShadowTouchListenersAttached = false;
		}
		this.host?.removeEventListener?.("pointerdown", this._onClosedShadowPointerDown, true);
		this.touchGestureStarts.clear();
		this.touchPointerFilterResults.length = 0;
		this.closedShadowPointerDecisions = /* @__PURE__ */ new WeakMap();
		this.touchActionListenersAttached = false;
	}
	_syncTouchActionListeners() {
		if (this.domPointerListenersAttached && (this.usesTouchInputFallback || createTouchActionPolicy(this.config.touchAction).requiresShim)) this._attachTouchActionListeners();
		else this._detachTouchActionListeners();
	}
	_detachDomPointerListeners() {
		if (!this.domPointerListenersAttached) return;
		this._detachTouchActionListeners();
		if (typeof window !== "undefined") {
			if (!this.usesTouchInputFallback) {
				window.removeEventListener("pointerdown", this._onPointerDown, true);
				window.removeEventListener("pointermove", this._onPointerMove, true);
			}
			window.removeEventListener("pointerup", this._onPointerUp, true);
			window.removeEventListener("pointercancel", this._onPointerCancel, true);
		}
		this.domPointerListenersAttached = false;
	}
	_touchTargetsMatch(event, left, right) {
		if (!left || !right || left === right) return true;
		const path = typeof event.composedPath === "function" ? event.composedPath() : [];
		return path.includes(left) && path.includes(right);
	}
	_touchInputsMatch(event, input, clientX, clientY, target) {
		const eventTargetsMatch = input.eventTarget && event.target && input.eventTarget === event.target;
		return Math.abs(input.clientX - clientX) <= TOUCH_INPUT_MATCH_TOLERANCE && Math.abs(input.clientY - clientY) <= TOUCH_INPUT_MATCH_TOLERANCE && (eventTargetsMatch || this._touchTargetsMatch(event, input.target, target));
	}
	_rememberTouchPointerFilterResult(event, accepted, filterAccepted = accepted) {
		this.touchPointerFilterResults.push({
			accepted,
			clientX: event.clientX,
			clientY: event.clientY,
			createdAt: performance.now(),
			eventTarget: event.target,
			filterAccepted,
			target: event.target
		});
		if (this.touchPointerFilterResults.length > 8) this.touchPointerFilterResults.shift();
	}
	_consumeTouchPointerFilterResult(event, touch) {
		const now = performance.now();
		const target = touch.target ?? event.target;
		for (let index = this.touchPointerFilterResults.length - 1; index >= 0; index--) {
			const result = this.touchPointerFilterResults[index];
			if (now - result.createdAt > TOUCH_FILTER_CACHE_MS) {
				this.touchPointerFilterResults.splice(index, 1);
				continue;
			}
			if (!this._touchInputsMatch(event, result, touch.clientX, touch.clientY, target)) continue;
			this.touchPointerFilterResults.splice(index, 1);
			return result;
		}
	}
	_consumeTouchGestureState(event) {
		for (const state of this.touchGestureStarts.values()) {
			if (state.pointerDecisionConsumed || !this._touchInputsMatch(event, state, event.clientX, event.clientY, event.target)) continue;
			state.pointerDecisionConsumed = true;
			return state;
		}
		return null;
	}
	_isTouchEventInScope(event, touchTarget = null) {
		if (!this.host) return true;
		const target = touchTarget ?? event.target;
		if (target === this.host || target && typeof this.host.contains === "function" && this.host.contains(target)) return true;
		return (typeof event.composedPath === "function" ? event.composedPath() : []).includes(this.host);
	}
	_isClosedShadowWindowTouchEvent(event) {
		if (!this._isHostInClosedShadowRoot()) return false;
		return (event.currentTarget === void 0 || event.currentTarget === (typeof window !== "undefined" ? window : null)) && !this._isTouchEventInScope(event, event.target);
	}
	_isHostInClosedShadowRoot() {
		let node = this.host;
		while (typeof node?.getRootNode === "function") {
			const root = node.getRootNode();
			if (!root?.host) return false;
			if (root.mode === "closed") return true;
			node = root.host;
		}
		return false;
	}
	_handleClosedShadowPointerDown(event) {
		if (this.destroyed || this.paused || event.pointerType !== "touch") return;
		const accepted = !this.inputFilter || this.inputFilter(event);
		this.closedShadowPointerDecisions.set(event, accepted);
		this._handlePointerDown(event);
	}
	_createTouchPointerEvent(event, touch, type = "pointermove", isPrimary = null) {
		const target = touch.target ?? event.target;
		const primaryTouchIdentifier = (event.touches ?? event.changedTouches)?.[0]?.identifier;
		const resolvedIsPrimary = isPrimary === null ? touch.identifier === primaryTouchIdentifier : isPrimary === true;
		const pageX = Number.isFinite(touch.pageX) ? touch.pageX : touch.clientX + (typeof window !== "undefined" ? window.pageXOffset || 0 : 0);
		const pageY = Number.isFinite(touch.pageY) ? touch.pageY : touch.clientY + (typeof window !== "undefined" ? window.pageYOffset || 0 : 0);
		return {
			type,
			target,
			currentTarget: event.currentTarget ?? (typeof window !== "undefined" ? window : null),
			pointerId: touch.identifier,
			pointerType: "touch",
			isPrimary: resolvedIsPrimary,
			button: type === "pointermove" ? -1 : 0,
			buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
			clientX: touch.clientX,
			clientY: touch.clientY,
			pageX,
			pageY,
			screenX: touch.screenX ?? touch.clientX,
			screenY: touch.screenY ?? touch.clientY,
			width: touch.radiusX ? touch.radiusX * 2 : 1,
			height: touch.radiusY ? touch.radiusY * 2 : 1,
			pressure: Number.isFinite(touch.force) ? touch.force : .5,
			timeStamp: event.timeStamp,
			cancelable: event.cancelable ?? false,
			defaultPrevented: event.defaultPrevented ?? false,
			composedPath: typeof event.composedPath === "function" ? event.composedPath.bind(event) : () => [],
			preventDefault: () => event.preventDefault?.(),
			stopPropagation: () => event.stopPropagation?.(),
			stopImmediatePropagation: () => event.stopImmediatePropagation?.()
		};
	}
	_acceptTouchStart(event, touch, isPrimary = null) {
		const target = touch.target ?? event.target;
		const pointerFilterResult = this._consumeTouchPointerFilterResult(event, touch);
		if (!this._isTouchEventInScope(event, target)) return {
			accepted: false,
			filterAccepted: false,
			isPrimary,
			pointerDecisionConsumed: false,
			pointerFilterPending: false,
			target
		};
		if (pointerFilterResult !== void 0) {
			const accepted = pointerFilterResult.accepted;
			return {
				accepted,
				filterAccepted: pointerFilterResult.filterAccepted ?? accepted,
				isPrimary,
				pointerDecisionConsumed: true,
				pointerFilterPending: false,
				target
			};
		}
		if (this.usesTouchInputFallback && this.inputFilter) {
			const accepted = this.inputFilter(this._createTouchPointerEvent(event, touch, "pointerdown", isPrimary));
			return {
				accepted,
				filterAccepted: accepted,
				isPrimary,
				pointerDecisionConsumed: true,
				pointerFilterPending: false,
				target
			};
		}
		if (!this.inputFilter) return {
			accepted: true,
			filterAccepted: true,
			isPrimary,
			pointerDecisionConsumed: false,
			pointerFilterPending: false,
			target
		};
		return {
			accepted: false,
			filterAccepted: false,
			isPrimary,
			pointerDecisionConsumed: false,
			pointerFilterPending: true,
			target
		};
	}
	_handleTouchStart(event) {
		if (this.destroyed || this.paused) return;
		if (this._isClosedShadowWindowTouchEvent(event)) return;
		const touches = event.changedTouches;
		const policy = createTouchActionPolicy(this.config.touchAction);
		const primaryTouchIdentifier = (event.touches ?? touches)?.[0]?.identifier;
		for (let index = 0; index < (touches?.length ?? 0); index++) {
			const touch = touches[index];
			const isPrimary = touch.identifier === primaryTouchIdentifier;
			const acceptance = this._acceptTouchStart(event, touch, isPrimary);
			this.touchGestureStarts.set(touch.identifier, {
				...acceptance,
				clientX: touch.clientX,
				clientY: touch.clientY,
				eventTarget: event.target,
				filterAccepted: acceptance.filterAccepted ?? acceptance.accepted,
				isPrimary,
				policy,
				preventDefault: null,
				x: touch.clientX,
				y: touch.clientY
			});
			if (this.usesTouchInputFallback && acceptance.filterAccepted) {
				const started = this._startDomPointer(this._createTouchPointerEvent(event, touch, "pointerdown", isPrimary));
				const state = this.touchGestureStarts.get(touch.identifier);
				if (state) {
					state.accepted = started;
					state.pointerFilterPending = false;
					if (started) this.fallbackTouchPointerId = touch.identifier;
				}
			}
		}
		if (policy.blockAll && event.cancelable) {
			if (Array.from(this.touchGestureStarts.values()).some((state) => state.accepted)) event.preventDefault();
		}
	}
	_getAcceptedTouchCount(event) {
		const touches = event.touches ?? event.changedTouches;
		let count = 0;
		for (let index = 0; index < (touches?.length ?? 0); index++) if (this.touchGestureStarts.get(touches[index].identifier)?.filterAccepted) count++;
		return count;
	}
	_isTouchDirectionAllowed(policy, axis, delta) {
		if (axis === "x") {
			if (!policy.allowX) return false;
			return policy.xDirections.has(delta < 0 ? TOUCH_ACTION_DIRECTIONS.negative : TOUCH_ACTION_DIRECTIONS.positive);
		}
		if (!policy.allowY) return false;
		return policy.yDirections.has(delta < 0 ? TOUCH_ACTION_DIRECTIONS.negative : TOUCH_ACTION_DIRECTIONS.positive);
	}
	_shouldPreventTouchMove(state, touch, acceptedTouchCount) {
		const policy = state.policy;
		if (policy.blockAll) return true;
		if (acceptedTouchCount > 1) return !policy.allowPinch;
		if (state.preventDefault !== null) return state.preventDefault;
		const deltaX = touch.clientX - state.x;
		const deltaY = touch.clientY - state.y;
		const absoluteX = Math.abs(deltaX);
		const absoluteY = Math.abs(deltaY);
		if (Math.max(absoluteX, absoluteY) < TOUCH_DIRECTION_THRESHOLD) return false;
		if (!policy.allowX && !policy.allowY) {
			state.preventDefault = true;
			return true;
		}
		if (absoluteX === absoluteY) return false;
		const axis = absoluteX > absoluteY ? "x" : "y";
		const delta = axis === "x" ? deltaX : deltaY;
		state.preventDefault = !this._isTouchDirectionAllowed(policy, axis, delta);
		return state.preventDefault;
	}
	_handleTouchMove(event) {
		if (this.destroyed || this.paused) return;
		if (this._isClosedShadowWindowTouchEvent(event)) return;
		const touches = event.changedTouches;
		let shouldPreventDefault = false;
		if (event.cancelable) {
			const acceptedTouchCount = this._getAcceptedTouchCount(event);
			for (let index = 0; index < (touches?.length ?? 0); index++) {
				const touch = touches[index];
				const start = this.touchGestureStarts.get(touch.identifier);
				if (!start?.accepted) continue;
				shouldPreventDefault = this._shouldPreventTouchMove(start, touch, acceptedTouchCount);
				if (shouldPreventDefault) break;
			}
		}
		if (this.usesTouchInputFallback) {
			const sourceNow = performance.now();
			const trailNow = this._getTrailInputTime(sourceNow);
			const sampleSourceTime = this._getDomInputSourceTime(event.timeStamp, sourceNow);
			const sampleTime = this._getDomTrailSampleTime(sampleSourceTime, sourceNow, trailNow);
			for (let index = 0; index < (touches?.length ?? 0); index++) {
				const touch = touches[index];
				const state = this.touchGestureStarts.get(touch.identifier);
				if (!state?.accepted) continue;
				this._pointerMoveAtTime(this._getDomPointerInput(this._createTouchPointerEvent(event, touch, "pointermove", state.isPrimary)), sampleTime, sampleSourceTime);
			}
		}
		if (shouldPreventDefault && event.cancelable) event.preventDefault();
	}
	_handleTouchEnd(event) {
		if (this._isClosedShadowWindowTouchEvent(event)) return;
		const touches = event.changedTouches;
		const pointerType = event.type === "touchcancel" ? "pointercancel" : "pointerup";
		for (let index = 0; index < (touches?.length ?? 0); index++) {
			const touch = touches[index];
			const state = this.touchGestureStarts.get(touch.identifier);
			if (this.usesTouchInputFallback && state?.accepted) {
				const pointerEvent = this._createTouchPointerEvent(event, touch, pointerType, state.isPrimary);
				if (pointerType === "pointercancel") this.pointerCancel(pointerEvent.pointerId);
				else this.pointerUp(pointerEvent.pointerId);
				if (this.fallbackTouchPointerId === pointerEvent.pointerId) this.fallbackTouchPointerId = null;
			}
			this.touchGestureStarts.delete(touch.identifier);
		}
		if (event.touches?.length === 0) {
			const fallbackPointerId = this.fallbackTouchPointerId;
			if (this.usesTouchInputFallback && fallbackPointerId !== null && this.activePointerId === fallbackPointerId && this.activePointerSource === "press") {
				if (pointerType === "pointercancel") this.pointerCancel(fallbackPointerId);
				else this.pointerUp(fallbackPointerId);
			}
			this.fallbackTouchPointerId = null;
			this.touchGestureStarts.clear();
			this.touchPointerFilterResults.length = 0;
		}
	}
	_getOverlayLayers() {
		return [
			this.canvas,
			this.webglBloomCanvas,
			this.webglEffectCanvas,
			this.webgpuEffectCanvas,
			this.canvasSceneCanvas,
			this.contrastCanvas
		].filter(Boolean);
	}
	_hasActiveCompositingReference() {
		if (this.compositingReferenceSource === null) return false;
		return this.webgpuEffectVisible && this.webgpuEffectRenderer?.hasSceneBackground === true || this.webglEffectVisible && this.webglEffectRenderer?.hasSceneBackground === true || this.webglBloomVisible && this.webglBloomRenderer?.hasSceneBackground === true || this.canvasSceneVisible && this.canvasSceneRenderer?.hasSceneBackground === true;
	}
	_usesUnknownBrowserOverlay() {
		return this.config.outputCompositing === "browser-overlay" && !this._hasActiveCompositingReference();
	}
	_usesIndependentHostPayload() {
		return isIndependentHostCompositing(this._getEffectiveHostCompositing());
	}
	_getEffectiveHostCompositing() {
		return this._resolveHostCompositingState().resolvedHostCompositing;
	}
	getEffectiveHostCompositing() {
		return this._getEffectiveHostCompositing();
	}
	_resolveHostCompositingState() {
		const resolution = resolveHostCompositing({
			outputCompositing: this.config.outputCompositing,
			requestedHostCompositing: this.config.hostCompositing,
			hostCompositingSurface: this.config.hostCompositingSurface,
			hasCompositingReference: this._hasActiveCompositingReference()
		});
		return {
			requestedHostCompositing: this.config.hostCompositing,
			hostCompositingSurface: this.config.hostCompositingSurface,
			...resolution
		};
	}
	_syncHostCompositingState() {
		const previous = this.hostCompositingState;
		const next = this._resolveHostCompositingState();
		const unchanged = previous && previous.requestedHostCompositing === next.requestedHostCompositing && previous.resolvedHostCompositing === next.resolvedHostCompositing && previous.hostCompositingSurface === next.hostCompositingSurface && previous.compositingWarning === next.compositingWarning;
		this.hostCompositingState = next;
		if (unchanged || typeof CustomEvent !== "function" || typeof this.canvas?.dispatchEvent !== "function") return;
		try {
			this.canvas.dispatchEvent(new CustomEvent(HOST_COMPOSITING_CHANGE_EVENT, { detail: { ...next } }));
		} catch {}
	}
	_getCanvasOutputCompositing() {
		return this._usesIndependentHostPayload() ? "host-additive" : this.config.outputCompositing;
	}
	_getOverlayColorCompensation() {
		return this._usesUnknownBrowserOverlay() && !this._usesIndependentHostPayload() ? this.config.overlayColorCompensation : "none";
	}
	_getOverlayAlphaPolicy() {
		return this._usesUnknownBrowserOverlay() && !this._usesIndependentHostPayload() ? this.config.overlayAlphaPolicy : "coverage";
	}
	_requestCompositingMountRefresh() {
		this._syncHostCompositingState();
		if (this._hasVisibleEffects()) {
			this.compositingMountPending = true;
			return;
		}
		this.compositingMountPending = false;
		this._applyCompositingMount();
	}
	_flushCompositingMountRefresh() {
		if (!this.compositingMountPending) return;
		this.compositingMountPending = false;
		this._applyCompositingMount();
	}
	_applyCompositingMount() {
		const hostIndependent = this._usesIndependentHostPayload();
		const usesDomBackdrop = this.config.hostCompositingSurface === "dom-backdrop";
		if (!this.ownsCanvas) return;
		if (!this.overlayMountParent || !this.overlayRoot) return;
		const grouped = this.config.isolatedCompositing || hostIndependent;
		const parent = grouped ? this.overlayRoot : this.overlayMountParent;
		this.overlayRoot.style.mixBlendMode = hostIndependent && usesDomBackdrop ? this._getEffectiveHostCompositing() : "";
		for (const canvas of this._getOverlayLayers()) {
			const contrastBlend = canvas === this.contrastCanvas && !hostIndependent;
			canvas.style.mixBlendMode = contrastBlend ? "darken" : "";
		}
		if (grouped) this.overlayMountParent.appendChild(this.overlayRoot);
		for (const canvas of this._getOverlayLayers()) {
			canvas.style.position = grouped || this.host ? "absolute" : "fixed";
			parent.appendChild(canvas);
		}
		if (!grouped) this.overlayRoot.remove();
		this.overlayParent = parent;
	}
	_createFxParamResetBaseline() {
		return structuredClone(UNITY_FX_TOUCH);
	}
	_commitFxParamConfig(nextConfig) {
		for (const key of Object.keys(this.fxConfig)) delete this.fxConfig[key];
		Object.assign(this.fxConfig, nextConfig);
	}
	resize(width, height, dpr) {
		this._resize(width, height, dpr);
	}
	_resize(overrideWidth, overrideHeight, overrideDpr) {
		if (this.destroyed) return;
		const rect = this._getCanvasRect();
		const defaultWidth = typeof window !== "undefined" ? window.innerWidth : this.canvas?.width;
		const defaultHeight = typeof window !== "undefined" ? window.innerHeight : this.canvas?.height;
		const defaultDpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
		const measuredWidth = resolvePositiveFinite(rect.width, resolvePositiveFinite(defaultWidth, 1));
		const measuredHeight = resolvePositiveFinite(rect.height, resolvePositiveFinite(defaultHeight, 1));
		const width = resolvePositiveFinite(overrideWidth, measuredWidth);
		const height = resolvePositiveFinite(overrideHeight, measuredHeight);
		const dpr = Math.min(resolvePositiveFinite(overrideDpr, resolvePositiveFinite(defaultDpr, 1)), this.config.maxDpr);
		this.width = width;
		this.height = height;
		this.dpr = dpr;
		this.canvas.width = Math.round(width * dpr);
		this.canvas.height = Math.round(height * dpr);
		if (this.context) this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (this.contrastCanvas && this.contrastContext) {
			this.contrastCanvas.width = this.canvas.width;
			this.contrastCanvas.height = this.canvas.height;
			this.contrastContext.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		this._requestRender();
	}
	_getCanvasRect() {
		if (this.host && !isCanvas(this.host) && typeof this.host.getBoundingClientRect === "function") return this.host.getBoundingClientRect();
		if (typeof this.canvas?.getBoundingClientRect === "function") return this.canvas.getBoundingClientRect();
		return {
			left: 0,
			top: 0,
			width: this.canvas?.width || 0,
			height: this.canvas?.height || 0
		};
	}
	_getPointerPosition(event) {
		const rect = this._getCanvasRect();
		return {
			x: clamp(event.clientX - rect.left, 0, this.width),
			y: clamp(event.clientY - rect.top, 0, this.height)
		};
	}
	_normalizePointerInput(input) {
		if (!input || !Number.isFinite(input.x) || !Number.isFinite(input.y) || input.pointerId !== void 0 && !Number.isFinite(input.pointerId) || input.pointerType !== void 0 && input.pointerType !== "mouse" && input.pointerType !== "touch" && input.pointerType !== "pen") return null;
		return {
			x: clamp(input.x, 0, this.width),
			y: clamp(input.y, 0, this.height),
			pointerId: input.pointerId ?? 1,
			pointerType: input.pointerType ?? "mouse"
		};
	}
	_getDomPointerInput(event, fallbackEvent = event) {
		const position = this._getPointerPosition(event);
		const pointerType = event.pointerType || fallbackEvent.pointerType || "mouse";
		return {
			...position,
			pointerId: event.pointerId ?? fallbackEvent.pointerId ?? 1,
			pointerType
		};
	}
	_getDomInputSourceTime(timeStamp, sourceNow) {
		if (!Number.isFinite(timeStamp) || timeStamp <= 0) return sourceNow;
		let sampleSourceTime = timeStamp;
		if (sampleSourceTime > sourceNow + 1e3 && Number.isFinite(performance.timeOrigin)) sampleSourceTime -= performance.timeOrigin;
		if (sampleSourceTime < 0 || sampleSourceTime > sourceNow + 1e3) return sourceNow;
		return Math.min(sampleSourceTime, sourceNow);
	}
	_getDomTrailSampleTime(sampleSourceTime, sourceNow, trailNow) {
		const elapsedMs = Math.max(0, sourceNow - sampleSourceTime);
		return Math.max(0, trailNow - scaleTimeDelta(elapsedMs, this.config.trailTimeScale));
	}
	_getTrailInputTime(now = performance.now()) {
		this._advanceTrailTime(now);
		return this.trailTimeMs;
	}
	_getClickInputTime(now = performance.now()) {
		this._advanceClickTime(now);
		return this.clickTimeMs;
	}
	_advanceClickTime(now = performance.now()) {
		if (this.paused || !Number.isFinite(now)) return 0;
		if (this.lastClickTimeSource === null) {
			this.lastClickTimeSource = now;
			return 0;
		}
		const elapsedMs = now - this.lastClickTimeSource;
		if (elapsedMs <= 0) return 0;
		const scaledDeltaMs = scaleTimeDelta(elapsedMs, this.config.clickTimeScale);
		this.clickTimeMs += scaledDeltaMs;
		this.lastClickTimeSource = now;
		return scaledDeltaMs;
	}
	_advanceTrailTime(now = performance.now()) {
		if (this.paused || !Number.isFinite(now)) return 0;
		if (this.lastTrailTimeSource === null) {
			this.lastTrailTimeSource = now;
			return 0;
		}
		const elapsedMs = now - this.lastTrailTimeSource;
		if (elapsedMs <= 0) return 0;
		const scaledDeltaMs = scaleTimeDelta(elapsedMs, this.config.trailTimeScale);
		this.trailTimeMs += scaledDeltaMs;
		this.lastTrailTimeSource = now;
		return scaledDeltaMs;
	}
	_getScale() {
		return this.config.scale * (this.height / UNITY_FX_TOUCH.referenceHeight) * 1;
	}
	_getEffectiveOpacity() {
		return this.config.opacity;
	}
	_getEffectiveOverlayAlphaLimit() {
		if (!this._usesUnknownBrowserOverlay() || this._usesIndependentHostPayload()) return this.config.overlayAlphaLimit;
		return this.config.overlayAlphaLimit * (this._relativeOklchTheme?.coverageScale ?? 1);
	}
	_getPointerDownDecision(event) {
		const decision = {
			accepted: false,
			rememberTouchPointerFilterResult: false,
			touchState: null
		};
		const pointerType = event.pointerType || "mouse";
		const usesTouchShim = pointerType === "touch" && event.type === "pointerdown" && this.touchActionListenersAttached;
		const hasClosedShadowDecision = usesTouchShim && this.closedShadowPointerDecisions.has(event);
		const closedShadowDecision = hasClosedShadowDecision ? this.closedShadowPointerDecisions.get(event) : void 0;
		const isClosedShadowRetarget = usesTouchShim && this._isHostInClosedShadowRoot() && !this._isTouchEventInScope(event, event.target);
		if (hasClosedShadowDecision) this.closedShadowPointerDecisions.delete(event);
		if (usesTouchShim) {
			const touchState = isClosedShadowRetarget ? null : this._consumeTouchGestureState(event);
			decision.touchState = touchState;
			if (touchState && !touchState.pointerFilterPending) {
				decision.accepted = touchState.accepted;
				return decision;
			}
			if (touchState) {
				decision.accepted = hasClosedShadowDecision ? closedShadowDecision : !this.inputFilter || this.inputFilter(event);
				touchState.accepted = decision.accepted;
				touchState.filterAccepted = decision.accepted;
				touchState.pointerFilterPending = false;
				return decision;
			}
		}
		if (hasClosedShadowDecision) {
			decision.accepted = closedShadowDecision;
			decision.rememberTouchPointerFilterResult = usesTouchShim;
			return decision;
		}
		if (pointerType === "mouse" && event.button > 0) return decision;
		if (usesTouchShim && !this._isTouchEventInScope(event, event.target)) {
			decision.rememberTouchPointerFilterResult = !this._isHostInClosedShadowRoot();
			return decision;
		}
		decision.accepted = !this.inputFilter || this.inputFilter(event);
		decision.rememberTouchPointerFilterResult = usesTouchShim;
		return decision;
	}
	_startDomPointer(event) {
		const accepted = this.pointerDown(this._getDomPointerInput(event));
		if (accepted && this.config.inputSamplingRate > 0) this.lastInputSampleSourceTime = this._getDomInputSourceTime(event.timeStamp, performance.now());
		return accepted;
	}
	_handlePointerDown(event) {
		if (this.destroyed || this.paused) return;
		const decision = this._getPointerDownDecision(event);
		if (!decision.accepted) {
			if (decision.touchState) {
				decision.touchState.accepted = false;
				decision.touchState.filterAccepted = false;
				decision.touchState.pointerFilterPending = false;
			}
			if (decision.rememberTouchPointerFilterResult) this._rememberTouchPointerFilterResult(event, false, false);
			return;
		}
		const accepted = this._startDomPointer(event) && decision.accepted;
		if (decision.touchState) {
			decision.touchState.accepted = accepted;
			decision.touchState.filterAccepted = decision.accepted;
			decision.touchState.pointerFilterPending = false;
		}
		if (decision.rememberTouchPointerFilterResult) this._rememberTouchPointerFilterResult(event, accepted, decision.accepted);
	}
	/**
	* 使用 Canvas 局部 CSS 像素开始一次点击和拖尾生命周期。
	* 手动输入由宿主完成按键和环境过滤，因此不会经过 inputFilter。
	*/
	pointerDown(input) {
		if (this.destroyed || this.paused) return false;
		const pointer = this._normalizePointerInput(input);
		if (!pointer) return false;
		if (this.activePointerId !== null && this.activePointerSource !== "hover") return false;
		if (this.activePointerId !== null && this.currentTrailStroke) this.currentTrailStroke.active = false;
		this.activePointerId = pointer.pointerId;
		this.activePointerSource = "press";
		this._beginTrailOwner();
		const inputSourceTime = performance.now();
		this.lastPointerPosition = {
			x: pointer.x,
			y: pointer.y
		};
		this.lastPointerTime = this._getTrailInputTime(inputSourceTime);
		this.lastInputSampleSourceTime = inputSourceTime;
		this.trailDistanceSinceShard = 0;
		if (this.config.trailEnabled) this._startTrailStroke(this.lastPointerPosition, this.lastPointerTime);
		if (this.config.clickEnabled) this._spawnClick(pointer.x, pointer.y);
		this._requestRender();
		return true;
	}
	_handlePointerMove(event) {
		if (this.destroyed || this.paused || !this.config.trailEnabled) return;
		if (this.activePointerId === null && this.config.trailAlways && !this._getPointerDownDecision(event).accepted) return;
		const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
		const events = coalesced.length > 0 ? coalesced : [event];
		const sourceNow = performance.now();
		const trailNow = this._getTrailInputTime(sourceNow);
		for (const sample of events) {
			const sampleSourceTime = this._getDomInputSourceTime(sample.timeStamp ?? event.timeStamp, sourceNow);
			const sampleTime = this._getDomTrailSampleTime(sampleSourceTime, sourceNow, trailNow);
			this._pointerMoveAtTime(this._getDomPointerInput(sample, event), sampleTime, sampleSourceTime);
		}
	}
	/** 追加一个手动指针采样点；采样 Hz 与空间阈值都不受时间倍率影响。 */
	pointerMove(input) {
		const inputSourceTime = performance.now();
		return this._pointerMoveAtTime(input, this._getTrailInputTime(inputSourceTime), inputSourceTime);
	}
	_pointerMoveAtTime(input, sampleTime = null, sampleSourceTime = null) {
		if (this.destroyed || this.paused || !this.config.trailEnabled) return false;
		const pointer = this._normalizePointerInput(input);
		if (!pointer) return false;
		const position = {
			x: pointer.x,
			y: pointer.y
		};
		const requestedTime = Number.isFinite(sampleTime) ? sampleTime : this._getTrailInputTime();
		const inputSourceTime = Number.isFinite(sampleSourceTime) ? sampleSourceTime : performance.now();
		const now = Math.max(this.lastPointerTime, requestedTime);
		if (this.activePointerId === null && this.config.trailAlways) {
			this.activePointerId = pointer.pointerId;
			this.activePointerSource = "hover";
			this._beginTrailOwner();
			this.lastPointerPosition = position;
			this.lastPointerTime = now;
			this.lastInputSampleSourceTime = inputSourceTime;
			this.trailDistanceSinceShard = 0;
			this._startTrailStroke(position, now, true);
			this._requestRender();
			return true;
		}
		if (this.activePointerId === null || pointer.pointerId !== this.activePointerId) return false;
		if (!this._acceptInputSample(inputSourceTime)) return true;
		this._ensureCurrentTrailStroke(now);
		this._appendPointerSample(position, now);
		this._requestRender();
		return true;
	}
	_acceptInputSample(inputSourceTime) {
		const rate = this.config.inputSamplingRate;
		if (rate <= 0) return true;
		if (!Number.isFinite(this.lastInputSampleSourceTime)) {
			this.lastInputSampleSourceTime = inputSourceTime;
			return true;
		}
		const intervalMs = 1e3 / rate;
		if (inputSourceTime - this.lastInputSampleSourceTime < intervalMs) return false;
		this.lastInputSampleSourceTime = inputSourceTime;
		return true;
	}
	_startTrailStroke(position, now, includeVisibleSeed = false) {
		const points = [createTrailPoint(position.x, position.y, now)];
		if (includeVisibleSeed) {
			const seedX = position.x < this.width ? position.x + .5 : position.x - .5;
			points.push(createTrailPoint(seedX, position.y, now));
		}
		this.currentTrailStroke = {
			active: true,
			ownerId: this.activeTrailOwnerId,
			points
		};
		this.trailStrokes.push(this.currentTrailStroke);
	}
	_beginTrailOwner() {
		const ownerId = this.nextTrailOwnerId;
		this.nextTrailOwnerId++;
		this.activeTrailOwnerId = ownerId;
		this.trailShardCounts.set(ownerId, 0);
	}
	_releaseTrailShardOwner(shard) {
		if (shard.kind !== "trail" || !Number.isFinite(shard.ownerId)) return;
		const nextCount = Math.max(0, (this.trailShardCounts.get(shard.ownerId) ?? 0) - 1);
		if (nextCount === 0 && shard.ownerId !== this.activeTrailOwnerId) {
			this.trailShardCounts.delete(shard.ownerId);
			return;
		}
		this.trailShardCounts.set(shard.ownerId, nextCount);
	}
	_ensureCurrentTrailStroke(now) {
		if (!this.lastPointerPosition) return;
		if (!this.currentTrailStroke) {
			this._startTrailStroke(this.lastPointerPosition, now);
			this.lastPointerTime = now;
			this.trailDistanceSinceShard = 0;
		} else if (this.currentTrailStroke.points.length === 0 || this.currentTrailStroke.points.length === 1 && now - this.currentTrailStroke.points[0].bornAt >= this.fxConfig.trail.lifetimeMs) {
			this.currentTrailStroke.points.length = 0;
			this.currentTrailStroke.points.push(createTrailPoint(this.lastPointerPosition.x, this.lastPointerPosition.y, now));
			this.lastPointerTime = now;
			this.trailDistanceSinceShard = 0;
		}
	}
	_appendPointerSample(position, now) {
		if (!this.currentTrailStroke || !this.lastPointerPosition) return;
		const from = this.lastPointerPosition;
		const segmentLength = distance(from, position);
		const scale = this._getScale();
		const vertexDistance = Math.max(.5, this.fxConfig.trail.minVertexDistance * scale);
		if (segmentLength < vertexDistance) return;
		const count = Math.min(512, Math.floor(segmentLength / vertexDistance));
		for (let index = 1; index <= count; index++) {
			const progress = index / count;
			const x = lerp(from.x, position.x, progress);
			const y = lerp(from.y, position.y, progress);
			const bornAt = lerp(this.lastPointerTime, now, progress);
			this.currentTrailStroke.points.push(createTrailPoint(x, y, bornAt));
		}
		this._spawnTrailShards(from, position, scale, this.lastPointerTime, now);
		this.lastPointerPosition = position;
		this.lastPointerTime = now;
	}
	_spawnTrailShards(from, to, scale, fromTime, toTime) {
		const segmentLength = distance(from, to);
		const spacing = Math.max(1, this.fxConfig.shards.trailSpacing * scale);
		let nextDistance = spacing - this.trailDistanceSinceShard;
		const ownerId = this.currentTrailStroke?.ownerId ?? this.activeTrailOwnerId;
		let ownerShardCount = Number.isFinite(ownerId) ? this.trailShardCounts.get(ownerId) ?? 0 : 0;
		while (Number.isFinite(ownerId) && nextDistance <= segmentLength && ownerShardCount < this.fxConfig.shards.maxCount) {
			const progress = segmentLength > 0 ? nextDistance / segmentLength : 0;
			const x = lerp(from.x, to.x, progress);
			const y = lerp(from.y, to.y, progress);
			const angle = random(0, TAU);
			this.shards.push(createShard(x, y, angle, "trail", scale, this.fxConfig.shards, lerp(fromTime, toTime, progress), ownerId));
			ownerShardCount++;
			this.trailShardCounts.set(ownerId, ownerShardCount);
			nextDistance += spacing;
		}
		this.trailDistanceSinceShard = (this.trailDistanceSinceShard + segmentLength) % spacing;
	}
	_handlePointerUp(event) {
		this.pointerUp(event.pointerId ?? 1);
	}
	_handlePointerCancel(event) {
		this.pointerCancel(event.pointerId ?? 1);
	}
	/** 结束指针；已有拖尾顶点继续自然消失。 */
	pointerUp(pointerId = 1) {
		if (this.destroyed || this.paused || !Number.isFinite(pointerId) || this.activePointerId === null || pointerId !== this.activePointerId) return false;
		this._releaseActivePointer(false);
		return true;
	}
	/** 强制结束异常指针状态，并立即移除当前轨迹。 */
	pointerCancel(pointerId = 1) {
		if (this.destroyed || this.paused || !Number.isFinite(pointerId) || this.activePointerId === null || pointerId !== this.activePointerId) return false;
		this._releaseActivePointer(true);
		return true;
	}
	_cancelPointer() {
		this.touchGestureStarts.clear();
		this.touchPointerFilterResults.length = 0;
		this.closedShadowPointerDecisions = /* @__PURE__ */ new WeakMap();
		if (this.activePointerId !== null) this._releaseActivePointer(true);
	}
	_releaseActivePointer(discardCurrentStroke = false) {
		const releasedPointerId = this.activePointerId;
		const releasedOwnerId = this.activeTrailOwnerId;
		if (this.currentTrailStroke) {
			this.currentTrailStroke.active = false;
			if (discardCurrentStroke || this.currentTrailStroke.points.length < 2) {
				const strokeIndex = this.trailStrokes.indexOf(this.currentTrailStroke);
				if (strokeIndex >= 0) this.trailStrokes.splice(strokeIndex, 1);
			}
		}
		this.currentTrailStroke = null;
		this.activeTrailOwnerId = null;
		if (releasedOwnerId !== null && (this.trailShardCounts.get(releasedOwnerId) ?? 0) === 0) this.trailShardCounts.delete(releasedOwnerId);
		if (this.fallbackTouchPointerId === releasedPointerId) this.fallbackTouchPointerId = null;
		this.activePointerId = null;
		this.activePointerSource = null;
		this.lastPointerPosition = null;
		this.lastPointerTime = 0;
		this.lastInputSampleSourceTime = null;
		this.trailDistanceSinceShard = 0;
		this._requestRender();
	}
	_spawnClick(x, y) {
		const scale = this._getScale();
		const clickTimeMs = this._getClickInputTime();
		this.waves.push(new ClickWave(x, y, this.fxConfig, clickTimeMs));
		for (let index = 0; index < this.fxConfig.shards.clickCount; index++) this.shards.push(createShard(x, y, random(0, TAU), "click", scale, this.fxConfig.shards, clickTimeMs));
	}
	_requestRender() {
		if (this.destroyed || this.paused || this.animationFrame !== null) return;
		this.lastFrameTime = this.lastFrameTime ?? performance.now();
		this.animationFrame = requestRenderFrame(this._onFrame);
	}
	_renderFrame(now) {
		if (this.destroyed || this.paused) {
			this.animationFrame = null;
			this.lastFrameTime = null;
			return;
		}
		this.animationFrame = null;
		this._advanceClickTime(now);
		this._advanceTrailTime(now);
		const scale = this._getScale();
		let effectBackend = this._prepareEffectBackend();
		let useGpuClickEffects = effectBackend !== null;
		let bloomBackend = useGpuClickEffects ? effectBackend : this._resolveBloomBackend();
		this._setResolvedBloomBackend(bloomBackend);
		if (!useGpuClickEffects && this.resolvedBloomBackend !== bloomBackend) bloomBackend = this._resolveBloomBackend();
		let useSoftwareBloom = bloomBackend === "software";
		let useWebGL2Bloom = bloomBackend === "webgl2";
		let useNativeBloom = bloomBackend === "native";
		const useCanvasScene = this._prepareCanvasSceneBackend(useGpuClickEffects, bloomBackend);
		const reuseCachedSoftwareBloom = !useGpuClickEffects && bloomBackend === "native" && !useCanvasScene && this._hasCachedSoftwareBloomFrame(scale);
		if (reuseCachedSoftwareBloom) useNativeBloom = false;
		const drawCanvasOutput = !useGpuClickEffects && !useCanvasScene && !useWebGL2Bloom;
		const deferNativeVisualMaxDraw = drawCanvasOutput && useNativeBloom && this._usesUnknownBrowserOverlay() && !this._usesIndependentHostPayload() && this._getOverlayAlphaPolicy() === "visual-max";
		const drawCanvasDuringUpdate = drawCanvasOutput && !deferNativeVisualMaxDraw;
		let canvasSceneRendered = false;
		this.lastFrameTime = now;
		if (!useGpuClickEffects) {
			this._setWebGLEffectVisible(false);
			this._setWebGPUEffectVisible(false);
		}
		if (!useCanvasScene) {
			const canvasSceneWasVisible = this.canvasSceneVisible;
			this._setCanvasSceneVisible(false);
			if (canvasSceneWasVisible) this._setCanvasOutputVisible(true);
		}
		this._setWebGLBloomVisible(!useGpuClickEffects && useWebGL2Bloom);
		if (!this.context && !useGpuClickEffects) this.context = this.canvas.getContext?.("2d") ?? null;
		if (this.context) {
			this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
			this.context.clearRect(0, 0, this.width, this.height);
		}
		const prevHueShift = themeHueShift;
		const previousRelativeOklchTheme = relativeOklchTheme;
		let contextSaved = false;
		this.canvasNativeSceneAlphaSnapshot = null;
		try {
			if (!useGpuClickEffects && this.context) {
				this.context.save();
				contextSaved = true;
			}
			themeHueShift = this._themeHueShift;
			relativeOklchTheme = this._relativeOklchTheme;
			if (this.context) this.context.globalCompositeOperation = this._getCanvasOutputCompositing() === "browser-overlay" ? "source-over" : "lighter";
			this.renderingFrame = true;
			this._updateTrail(this.trailTimeMs, scale, useNativeBloom, drawCanvasDuringUpdate, useGpuClickEffects || useWebGL2Bloom);
			this._updateWaves(this.clickTimeMs, scale, useNativeBloom, drawCanvasDuringUpdate);
			this._updateShards(this.clickTimeMs, this.trailTimeMs, scale, drawCanvasDuringUpdate);
			if (useGpuClickEffects) {
				if (!this._renderGPUClickEffects(effectBackend, scale)) {
					const failedBackend = effectBackend;
					useGpuClickEffects = false;
					effectBackend = null;
					this._setResolvedEffectBackend(failedBackend === "webgpu" ? "pending" : "canvas2d");
					this._setWebGLEffectVisible(false);
					this._setWebGPUEffectVisible(false);
					bloomBackend = this._resolveBloomBackend();
					useSoftwareBloom = bloomBackend === "software";
					useWebGL2Bloom = bloomBackend === "webgl2";
					useNativeBloom = bloomBackend === "native";
					this._setResolvedBloomBackend(bloomBackend);
					if (this.resolvedBloomBackend !== bloomBackend) {
						bloomBackend = this._resolveBloomBackend();
						useSoftwareBloom = bloomBackend === "software";
						useWebGL2Bloom = bloomBackend === "webgl2";
						useNativeBloom = bloomBackend === "native";
					}
					this._setWebGLBloomVisible(useWebGL2Bloom);
					this._drawCanvasFallbackFrame(scale, useNativeBloom);
				} else {
					this._setWebGLEffectVisible(effectBackend === "webgl2");
					this._setWebGPUEffectVisible(effectBackend === "webgpu");
					this._setResolvedEffectBackend(effectBackend);
				}
			} else if (useCanvasScene) {
				canvasSceneRendered = this._renderCanvasSceneEffects(scale, useNativeBloom);
				if (!canvasSceneRendered) {
					this._setCanvasSceneVisible(false);
					this._drawCanvasFallbackFrame(scale, useNativeBloom);
				}
				this._setCanvasSceneVisible(canvasSceneRendered);
				this._setCanvasOutputVisible(!canvasSceneRendered);
			} else if (!useWebGL2Bloom) {
				if (deferNativeVisualMaxDraw) this._drawCanvasFallbackFrame(scale, useNativeBloom);
				else this._drawWaveRings(scale, useNativeBloom);
			}
			const hasDedicatedSceneOutput = useGpuClickEffects || useWebGL2Bloom || canvasSceneRendered;
			this._renderLightBackgroundContrast(scale, useSoftwareBloom && !hasDedicatedSceneOutput);
			if (reuseCachedSoftwareBloom) {
				if (!this._drawCachedSoftwareBloomFrame(scale)) {
					this._drawCanvasFallbackFrame(scale, true, false);
					this._renderLightBackgroundContrast(scale, false);
				}
			} else if (!useGpuClickEffects && useSoftwareBloom && this._hasVisibleEffects()) this._renderSoftwareBloom(scale);
			else if (!useGpuClickEffects && useWebGL2Bloom && this._hasVisibleEffects()) this._renderWebGL2Bloom(scale);
			else if (!useGpuClickEffects && useWebGL2Bloom) this.webglBloomRenderer?.clear();
			this._finalizeCanvasOverlayAlpha(scale);
		} catch (error) {
			console.error("[BAClickFX] render error:", error);
			if (useCanvasScene) {
				this._setCanvasSceneVisible(false);
				this._setCanvasOutputVisible(true);
			}
		} finally {
			this.renderingFrame = false;
			themeHueShift = prevHueShift;
			relativeOklchTheme = previousRelativeOklchTheme;
			if (contextSaved) this.context.restore();
		}
		this._flushCompositingMountRefresh();
		if (this._hasVisibleEffects()) this._requestRender();
		else this.lastFrameTime = null;
	}
	_getRequestedEffectBackendState() {
		const requested = normalizeEffectBackend(this.config.effectBackend);
		const isDirectCanvas = isOffscreenCanvas(this.canvas);
		if (requested === "canvas2d" || !this.ownsCanvas && !isDirectCanvas || this.ownsCanvas && !this.overlayParent) return "canvas2d";
		if (requested === "webgpu" || requested === "auto") {
			if (this.webgpuEffectVisible && this.webgpuEffectRenderer?.available) return "webgpu";
			if (!this.webgpuEffectUnavailable && (!this.webgpuEffectRenderer || this.webgpuEffectRenderer.status === "pending" || this.webgpuEffectRenderer.status === "ready")) return "pending";
		}
		if (this.webglEffectVisible && this.webglEffectRenderer?.available) return "webgl2";
		if (this.webglEffectUnavailable || this.webglEffectRenderer && (!this.webglEffectRenderer.available || this.webglEffectRenderer.contextLost)) return "canvas2d";
		return "pending";
	}
	_getRequestedBloomBackendState() {
		const requested = normalizeBloomBackend(this.config.bloomBackend);
		const fallback = this._resolveCanvasFallbackBloomBackend();
		if (this.webgpuEffectVisible && this.webgpuEffectRenderer?.available) return "webgpu";
		if (this.webglEffectVisible && this.webglEffectRenderer?.available) return "webgl2";
		if (requested === "native") return "native";
		if (requested === "software") return fallback;
		if (this.webglBloomRenderer) {
			const renderer = this.webglBloomRenderer;
			return renderer.available && renderer.sourceTarget && renderer.levels?.length > 0 ? "webgl2" : fallback;
		}
		if (this.webglBloomUnavailable || !this.ownsCanvas || !this.overlayParent) return fallback;
		return "pending";
	}
	_setResolvedEffectBackend(backend) {
		if (this.resolvedEffectBackend === backend) return;
		this.resolvedEffectBackend = backend;
		if (typeof CustomEvent !== "function" || typeof this.canvas?.dispatchEvent !== "function") return;
		try {
			this.canvas.dispatchEvent(new CustomEvent(EFFECT_BACKEND_CHANGE_EVENT, { detail: {
				requestedEffectBackend: this.config.effectBackend,
				resolvedEffectBackend: backend
			} }));
		} catch {}
	}
	_setResolvedBloomBackend(backend) {
		if (this.resolvedBloomBackend === backend) return;
		this.resolvedBloomBackend = backend;
		if (typeof CustomEvent !== "function" || typeof this.canvas?.dispatchEvent !== "function") return;
		try {
			this.canvas.dispatchEvent(new CustomEvent(BLOOM_BACKEND_CHANGE_EVENT, { detail: {
				requestedBloomBackend: this.config.bloomBackend,
				resolvedBloomBackend: backend
			} }));
		} catch {}
	}
	_handleWebGPUEffectStateChange(renderer, status) {
		if (this.destroyed || renderer !== this.webgpuEffectRenderer) return;
		const requested = normalizeEffectBackend(this.config.effectBackend);
		if (status === "ready") {
			this.webgpuEffectUnavailable = false;
			if (requested === "webgpu" || requested === "auto") {
				this._setResolvedEffectBackend("pending");
				this._requestRender();
			}
			return;
		}
		if (status !== "lost" && status !== "unavailable") return;
		const wasVisible = this.webgpuEffectVisible;
		this.webgpuEffectUnavailable = true;
		this._setWebGPUEffectVisible(false);
		if (wasVisible && (this.paused || !this.renderingFrame)) {
			const fallbackBackend = this._resolveCanvasFallbackBloomBackend();
			this._restoreCanvasOutputAfterContextLoss(fallbackBackend);
		} else this._setCanvasOutputVisible(true);
		this._setResolvedEffectBackend(this._getRequestedEffectBackendState());
		this._setResolvedBloomBackend(this._getRequestedBloomBackendState());
		this._requestRender();
	}
	_ensureWebGPUEffectRenderer() {
		if (this.webgpuEffectRenderer) {
			this.webgpuEffectRenderer.setPreferHdr(this.config.webgpuPreferHdr);
			return this.webgpuEffectRenderer.available;
		}
		if (this.webgpuEffectUnavailable || !this.ownsCanvas || !this.overlayParent) return false;
		const canvas = createCanvas();
		setOverlayStyle(canvas, !this.host && !this.config.isolatedCompositing, "2147483646", "");
		canvas.style.display = "none";
		this.overlayParent.appendChild(canvas);
		let renderer = null;
		try {
			renderer = new WebGPUEffectRenderer(canvas, {
				preferHdr: this.config.webgpuPreferHdr,
				onStateChange: (status, candidate) => this._handleWebGPUEffectStateChange(candidate, status)
			});
			const compositingReference = this.compositingReferenceSource;
			if (compositingReference !== null && !renderer.setCompositingReference(compositingReference, { fit: this.compositingReferenceFit })) throw new Error("WebGPU 无法接入当前合成参考");
		} catch (error) {
			console.warn("[BAClickFX] WebGPU 创建失败:", error);
			this.webgpuEffectUnavailable = true;
			renderer?.destroy();
			canvas.remove();
			return false;
		}
		this.webgpuEffectCanvas = canvas;
		this.webgpuEffectRenderer = renderer;
		return renderer.available;
	}
	_resizeWebGPUEffectRenderer() {
		return !!this.webgpuEffectRenderer?.resize(this.width, this.height, this.dpr, this.fxConfig.bloom.resolutionScale, this.fxConfig.bloom.diffusion);
	}
	_prepareWebGPUEffectBackend() {
		if (this._ensureWebGPUEffectRenderer() && this._resizeWebGPUEffectRenderer()) {
			if (this.resolvedEffectBackend !== "webgpu") this._setResolvedEffectBackend("pending");
			return true;
		}
		if (this.webgpuEffectRenderer?.status === "pending" || this.webgpuEffectRenderer?.status === "ready") this._setResolvedEffectBackend("pending");
		return false;
	}
	_prepareEffectBackend() {
		const requested = normalizeEffectBackend(this.config.effectBackend);
		if (requested === "canvas2d") {
			this._setResolvedEffectBackend("canvas2d");
			return null;
		}
		if (requested === "webgpu" || requested === "auto") {
			if (this._prepareWebGPUEffectBackend()) return "webgpu";
			if (!this.webgpuEffectUnavailable && this.webgpuEffectRenderer?.status === "pending") return null;
		}
		return this._prepareWebGLEffectBackend() ? "webgl2" : null;
	}
	_setWebGPUEffectVisible(visible) {
		if (!visible && this.webgpuEffectRenderer && !this.webgpuEffectRenderer.suspendPresentation()) {
			const changed = this.webgpuEffectVisible;
			console.warn("[BAClickFX] WebGPU Canvas 暂停失败，已释放该 Renderer");
			this._destroyWebGPUEffectRenderer();
			this.webgpuEffectUnavailable = false;
			if (changed) this._requestCompositingMountRefresh();
			return;
		}
		if (!this.webgpuEffectCanvas) {
			const changed = this.webgpuEffectVisible;
			this.webgpuEffectVisible = false;
			if (changed) this._requestCompositingMountRefresh();
			return;
		}
		if (this.webgpuEffectVisible === visible) return;
		this.webgpuEffectVisible = visible;
		this.webgpuEffectCanvas.style.display = visible ? "" : "none";
		this._requestCompositingMountRefresh();
	}
	_destroyWebGPUEffectRenderer() {
		const renderer = this.webgpuEffectRenderer;
		this.webgpuEffectRenderer = null;
		this.webgpuEffectCanvas?.remove();
		this.webgpuEffectCanvas = null;
		this.webgpuEffectVisible = false;
		renderer?.destroy();
	}
	_handleWebGLContextLost() {
		if (this.destroyed || !this.webglBloomVisible) return;
		const fallbackBackend = this._resolveCanvasFallbackBloomBackend();
		this._setWebGLBloomVisible(false);
		if (this.paused || !this.renderingFrame) this._restoreCanvasOutputAfterContextLoss(fallbackBackend);
		else this._setResolvedBloomBackend(fallbackBackend);
		this._requestRender();
	}
	_handleWebGLContextRestored() {
		if (this.destroyed) return;
		if (!this.webglBloomRenderer?.available) {
			this._destroyWebGLBloomRenderer();
			this.webglBloomUnavailable = false;
		}
		if (this.paused || !this._hasVisibleEffects() || normalizeEffectBackend(this.config.effectBackend) !== "canvas2d") return;
		const requested = normalizeBloomBackend(this.config.bloomBackend);
		if (requested !== "webgl2" && requested !== "auto") return;
		this._setResolvedBloomBackend("pending");
		this._requestRender();
	}
	_handleWebGLEffectContextLost() {
		if (this.destroyed || !this.webglEffectVisible) return;
		this._setWebGLEffectVisible(false);
		this._setResolvedEffectBackend("canvas2d");
		const fallbackBackend = this._resolveCanvasFallbackBloomBackend();
		if (this.paused || !this.renderingFrame) this._restoreCanvasOutputAfterContextLoss(fallbackBackend);
		else {
			this._setResolvedBloomBackend(fallbackBackend);
			this._setCanvasOutputVisible(true);
		}
		this._requestRender();
	}
	_handleWebGLEffectContextRestored() {
		if (this.destroyed) return;
		if (!this.webglEffectRenderer?.available) {
			this._destroyWebGLEffectRenderer();
			this.webglEffectUnavailable = false;
		}
		if (this.paused || !this._hasVisibleEffects()) return;
		if (normalizeEffectBackend(this.config.effectBackend) !== "canvas2d") {
			this._setResolvedEffectBackend("pending");
			this._requestRender();
		}
	}
	_ensureWebGLEffectRenderer() {
		if (this.webglEffectRenderer) return this.webglEffectRenderer.available;
		if (this.webglEffectUnavailable) return false;
		const isDirectCanvas = isOffscreenCanvas(this.canvas);
		if (!this.ownsCanvas && !isDirectCanvas) return false;
		if (this.ownsCanvas && !this.overlayParent) return false;
		const canvas = this.ownsCanvas ? createCanvas() : this.canvas;
		if (this.ownsCanvas && this.overlayParent) {
			setOverlayStyle(canvas, !this.host && !this.config.isolatedCompositing, "2147483646", "");
			canvas.style.display = "none";
			this.overlayParent.appendChild(canvas);
		}
		let renderer = null;
		try {
			renderer = new WebGL2EffectRenderer(canvas);
			if (!renderer.available) {
				this.webglEffectUnavailable = true;
				renderer.destroy();
				if (this.ownsCanvas) canvas.remove();
				return false;
			}
			const compositingReference = this.compositingReferenceSource;
			if (compositingReference !== null) {
				if (!renderer.setCompositingReference(compositingReference, { fit: this.compositingReferenceFit })) {
					this.webglEffectUnavailable = true;
					renderer.destroy();
					if (this.ownsCanvas) canvas.remove();
					return false;
				}
			}
		} catch (error) {
			console.warn("[BAClickFX] 纯 WebGL2 创建失败:", error);
			this.webglEffectUnavailable = true;
			renderer?.destroy();
			if (this.ownsCanvas) canvas.remove();
			return false;
		}
		this.webglEffectCanvas = canvas;
		this.webglEffectRenderer = renderer;
		canvas.addEventListener?.("webglcontextlost", this._onWebGLEffectContextLost);
		canvas.addEventListener?.("webglcontextrestored", this._onWebGLEffectContextRestored);
		return true;
	}
	_resizeWebGLEffectRenderer() {
		return !!this.webglEffectRenderer?.resize(this.width, this.height, this.dpr, this.fxConfig.bloom.resolutionScale, this.fxConfig.bloom.diffusion);
	}
	_prepareWebGLEffectBackend() {
		if (normalizeEffectBackend(this.config.effectBackend) === "canvas2d") {
			this._setResolvedEffectBackend("canvas2d");
			return false;
		}
		const ready = this._ensureWebGLEffectRenderer() && this._resizeWebGLEffectRenderer();
		if (!ready) this._setResolvedEffectBackend("canvas2d");
		else if (this.resolvedEffectBackend !== "webgl2") this._setResolvedEffectBackend("pending");
		return ready;
	}
	_setWebGLEffectVisible(visible) {
		if (!this.webglEffectCanvas) {
			const changed = this.webglEffectVisible;
			this.webglEffectVisible = false;
			if (changed) this._requestCompositingMountRefresh();
			return;
		}
		if (this.webglEffectVisible === visible) return;
		this.webglEffectVisible = visible;
		if (this.webglEffectCanvas.style) this.webglEffectCanvas.style.display = visible ? "" : "none";
		if (!visible) this.webglEffectRenderer?.clear();
		this._requestCompositingMountRefresh();
	}
	_destroyWebGLEffectRenderer() {
		this.webglEffectCanvas?.removeEventListener?.("webglcontextlost", this._onWebGLEffectContextLost);
		this.webglEffectCanvas?.removeEventListener?.("webglcontextrestored", this._onWebGLEffectContextRestored);
		this.webglEffectRenderer?.destroy?.();
		if (this.ownsCanvas) this.webglEffectCanvas?.remove?.();
		this.webglEffectRenderer = null;
		this.webglEffectCanvas = null;
		this.webglEffectVisible = false;
	}
	_handleCanvasSceneContextLost() {
		if (this.destroyed || !this.canvasSceneVisible) return;
		this._setCanvasSceneVisible(false);
		if (this.paused || !this.renderingFrame) this._restoreCanvasOutputAfterContextLoss("native");
		this._requestRender();
	}
	_handleCanvasSceneContextRestored() {
		if (this.destroyed) return;
		if (!this.canvasSceneRenderer?.available) {
			this._destroyCanvasSceneRenderer();
			this.canvasSceneUnavailable = false;
		}
		if (!this._hasCompositingReference() || !this._hasVisibleEffects()) return;
		if (this.resolvedEffectBackend === "canvas2d" && this.resolvedBloomBackend === "native") this._requestRender();
	}
	_ensureCanvasSceneRenderer() {
		if (this.canvasSceneRenderer) return this.canvasSceneRenderer.available;
		if (this.canvasSceneUnavailable || !this.ownsCanvas || !this.overlayParent) return false;
		const canvas = createCanvas();
		setOverlayStyle(canvas, !this.host && !this.config.isolatedCompositing, "2147483646", "");
		canvas.style.display = "none";
		this.overlayParent.appendChild(canvas);
		let renderer = null;
		try {
			renderer = new WebGL2CanvasSceneRenderer(canvas);
			if (!renderer.available) {
				this.canvasSceneUnavailable = true;
				renderer.destroy();
				canvas.remove();
				return false;
			}
			const compositingReference = this.compositingReferenceSource;
			if (compositingReference !== null) {
				if (!renderer.setCompositingReference(compositingReference, { fit: this.compositingReferenceFit })) {
					this.canvasSceneUnavailable = true;
					renderer.destroy();
					canvas.remove();
					return false;
				}
			}
		} catch (error) {
			console.warn("[BAClickFX] Canvas Scene Final Pass 创建失败:", error);
			this.canvasSceneUnavailable = true;
			renderer?.destroy();
			canvas.remove();
			return false;
		}
		this.canvasSceneCanvas = canvas;
		this.canvasSceneRenderer = renderer;
		canvas.addEventListener("webglcontextlost", this._onCanvasSceneContextLost);
		canvas.addEventListener("webglcontextrestored", this._onCanvasSceneContextRestored);
		return true;
	}
	_resizeCanvasSceneRenderer() {
		return !!this.canvasSceneRenderer?.resize(this.width, this.height, this.dpr);
	}
	_prepareCanvasSceneBackend(useGpuClickEffects, bloomBackend) {
		if (useGpuClickEffects || bloomBackend !== "native" || !this._hasCompositingReference()) return false;
		return this._ensureCanvasSceneRenderer() && this._resizeCanvasSceneRenderer() && this.canvasSceneRenderer.hasSceneBackground;
	}
	_setCanvasSceneVisible(visible) {
		if (!this.canvasSceneCanvas) {
			const changed = this.canvasSceneVisible;
			this.canvasSceneVisible = false;
			if (changed) this._requestCompositingMountRefresh();
			return;
		}
		if (this.canvasSceneVisible === visible) return;
		this.canvasSceneVisible = visible;
		this.canvasSceneCanvas.style.display = visible ? "" : "none";
		if (!visible) this.canvasSceneRenderer?.clear();
		this._requestCompositingMountRefresh();
	}
	_destroyCanvasSceneRenderer() {
		this.canvasSceneCanvas?.removeEventListener("webglcontextlost", this._onCanvasSceneContextLost);
		this.canvasSceneCanvas?.removeEventListener("webglcontextrestored", this._onCanvasSceneContextRestored);
		this.canvasSceneRenderer?.destroy();
		this.canvasSceneCanvas?.remove();
		this.canvasSceneRenderer = null;
		this.canvasSceneCanvas = null;
		this.canvasSceneVisible = false;
	}
	_destroyWebGLBloomRenderer() {
		this.webglBloomCanvas?.removeEventListener("webglcontextlost", this._onWebGLContextLost);
		this.webglBloomCanvas?.removeEventListener("webglcontextrestored", this._onWebGLContextRestored);
		this.webglBloomRenderer?.destroy();
		this.webglBloomCanvas?.remove();
		this.webglBloomRenderer = null;
		this.webglBloomCanvas = null;
		this.webglBloomVisible = false;
	}
	_ensureWebGLBloomRenderer() {
		if (this.webglBloomRenderer) return this.webglBloomRenderer.available;
		if (this.webglBloomUnavailable || !this.ownsCanvas || !this.overlayParent) return false;
		const canvas = createCanvas();
		setOverlayStyle(canvas, !this.host && !this.config.isolatedCompositing, "2147483646", "");
		canvas.style.display = "none";
		this.overlayParent.appendChild(canvas);
		let renderer = null;
		try {
			renderer = new WebGL2EffectRenderer(canvas);
			if (!renderer.available) {
				this.webglBloomUnavailable = true;
				renderer.destroy();
				canvas.remove();
				return false;
			}
			const compositingReference = this.compositingReferenceSource;
			if (compositingReference !== null) {
				if (!renderer.setCompositingReference(compositingReference, { fit: this.compositingReferenceFit })) {
					this.webglBloomUnavailable = true;
					renderer.destroy();
					canvas.remove();
					return false;
				}
			}
		} catch (error) {
			console.warn("[BAClickFX] WebGL2 Bloom 创建失败，回退软件 Bloom:", error);
			this.webglBloomUnavailable = true;
			renderer?.destroy();
			canvas.remove();
			return false;
		}
		this.webglBloomCanvas = canvas;
		this.webglBloomRenderer = renderer;
		canvas.addEventListener("webglcontextlost", this._onWebGLContextLost);
		canvas.addEventListener("webglcontextrestored", this._onWebGLContextRestored);
		return renderer.available;
	}
	_resizeWebGLBloomRenderer() {
		return !!this.webglBloomRenderer?.resize(this.width, this.height, this.dpr, this.fxConfig.bloom.resolutionScale, this.fxConfig.bloom.diffusion);
	}
	_resolveBloomBackend() {
		const requested = normalizeBloomBackend(this.config.bloomBackend);
		if (requested === "native") return "native";
		if (requested === "software") return this.bloomRenderer.available ? "software" : "native";
		if (this._ensureWebGLBloomRenderer() && this._resizeWebGLBloomRenderer()) return "webgl2";
		return "native";
	}
	_resolveCanvasFallbackBloomBackend() {
		return normalizeBloomBackend(this.config.bloomBackend) === "software" && this.bloomRenderer?.available ? "software" : "native";
	}
	_setWebGLBloomVisible(visible) {
		if (!this.webglBloomCanvas) {
			const changed = this.webglBloomVisible;
			this.webglBloomVisible = false;
			if (changed) this._requestCompositingMountRefresh();
			return;
		}
		const wasVisible = this.webglBloomVisible;
		if (!visible && wasVisible) this._setCanvasOutputVisible(true);
		if (this.webglBloomVisible === visible) return;
		this.webglBloomVisible = visible;
		this.webglBloomCanvas.style.display = visible ? "" : "none";
		if (!visible) this.webglBloomRenderer?.clear();
		this._requestCompositingMountRefresh();
	}
	_setCanvasOutputVisible(visible) {
		if (!this.ownsCanvas) return;
		const visibility = visible ? "" : "hidden";
		this.canvas.style.visibility = visibility;
		if (this.contrastCanvas) {
			const contrastEnabled = this.config.outputCompositing !== "browser-overlay" && this.config.lightBackgroundContrastAlpha > 0;
			this.contrastCanvas.style.visibility = visible || contrastEnabled ? "" : "hidden";
		}
	}
	_invalidateSceneBackgroundOutputs() {
		this._setWebGPUEffectVisible(false);
		this._setWebGLEffectVisible(false);
		this._setWebGLBloomVisible(false);
		this._setCanvasSceneVisible(false);
		this.webglEffectRenderer?.clear();
		this.webglBloomRenderer?.clear();
		this.canvasSceneRenderer?.clear();
		if (this.context) {
			this.context.save();
			this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
			this.context.clearRect(0, 0, this.width, this.height);
			this.context.restore();
		}
		this._clearLightBackgroundContrast();
		this._setCanvasOutputVisible(true);
	}
	_releaseBackendFrameResources() {
		this._setWebGPUEffectVisible(false);
		this._setWebGLEffectVisible(false);
		this._setWebGLBloomVisible(false);
		this._setCanvasSceneVisible(false);
		this.webgpuEffectRenderer?.releaseFrameResources();
		this.webglEffectRenderer?.releaseFrameResources();
		this.webglBloomRenderer?.releaseFrameResources();
		this.canvasSceneRenderer?.releaseFrameResources();
		this._setCanvasOutputVisible(true);
	}
	_releaseBloomBackendFrameResources() {
		this._setWebGLBloomVisible(false);
		this._setCanvasSceneVisible(false);
		this.webglBloomRenderer?.releaseFrameResources();
		this.canvasSceneRenderer?.releaseFrameResources();
		if (!this.webglEffectVisible && !this.webgpuEffectVisible) this._setCanvasOutputVisible(true);
	}
	_usesSoftwareBloom() {
		return this._resolveBloomBackend() === "software";
	}
	_getBloomRenderer(index) {
		while (this.bloomRenderers.length <= index) this.bloomRenderers.push(new SoftwareBloomRenderer(() => createCanvas()));
		return this.bloomRenderers[index];
	}
	_trimBloomRendererPool(activeCount, reserve = 2) {
		const retainedCount = activeCount === 0 ? 1 : Math.max(1, activeCount + reserve);
		if (this.bloomRenderers.length <= retainedCount) return;
		const removed = this.bloomRenderers.splice(retainedCount);
		for (const renderer of removed) renderer.destroy();
	}
	_getNativeTrailBloomSurface() {
		if (this.nativeTrailBloomSurface === void 0) {
			const canvas = createCanvas();
			const context = canvas.getContext("2d");
			this.nativeTrailBloomSurface = context ? {
				canvas,
				context,
				dpr: this.dpr
			} : null;
		}
		if (this.nativeTrailBloomSurface) this.nativeTrailBloomSurface.dpr = this.dpr;
		return this.nativeTrailBloomSurface;
	}
	_renderLightBackgroundContrast(scale, reuseMainCanvas = false) {
		const context = this.contrastContext;
		if (!context || !this.contrastCanvas) return;
		context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		context.clearRect(0, 0, this.width, this.height);
		if (this.config.outputCompositing === "browser-overlay" || this.config.lightBackgroundContrastAlpha <= 0) return;
		if (reuseMainCanvas) {
			context.save();
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.globalCompositeOperation = "source-over";
			context.drawImage(this.canvas, 0, 0);
			context.restore();
		} else {
			context.save();
			context.globalCompositeOperation = "lighter";
			for (const stroke of this.trailStrokes) if (stroke.points.length >= 2) drawTrail(context, stroke.points, scale, this._getEffectiveOpacity(), this.fxConfig, false, false, null, stroke.trailFrameData);
			for (const wave of this.waves) wave.drawBase(context, scale, this._getEffectiveOpacity(), false, this.config.outputCompositing, this.dpr);
			for (const shard of this.shards) shard.draw(context, scale, this._getEffectiveOpacity(), this.fxConfig);
			for (const wave of this.waves) wave.drawRings(context, scale, this._getEffectiveOpacity(), false, false, null, this.dpr, this.config.outputCompositing);
			context.restore();
		}
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.globalCompositeOperation = "source-in";
		context.fillStyle = colorToCss(LIGHT_BACKGROUND_CONTRAST_COLOR, this.config.lightBackgroundContrastAlpha);
		context.fillRect(0, 0, this.contrastCanvas.width, this.contrastCanvas.height);
		context.restore();
	}
	_getSoftwareBloomRegions(scale) {
		const bloomCfg = this.fxConfig.bloom;
		const padding = 2 ** bloomCfg.diffusion * scale + 8;
		const regions = [];
		const addRegion = (minimumX, minimumY, maximumX, maximumY, wave, trailBatches = [], shards = []) => {
			mergeBloomRegion(regions, {
				x: minimumX - padding,
				y: minimumY - padding,
				width: maximumX - minimumX + padding * 2,
				height: maximumY - minimumY + padding * 2,
				emissionBounds: {
					x: minimumX,
					y: minimumY,
					width: maximumX - minimumX,
					height: maximumY - minimumY
				},
				waves: wave ? [wave] : [],
				trailBatches,
				shards
			});
		};
		for (const wave of this.waves) {
			if (wave.fx.bloom.clickEmissionScale <= 0) continue;
			const diskProgress = wave.ageMs / this.fxConfig.disk.lifetimeMs;
			const ringProgress = wave.ageMs / this.fxConfig.rings.lifetimeMs;
			let sourceRadius = diskProgress < 1 ? this.fxConfig.disk.radius * evaluateUnityHermiteCurve(this.fxConfig.disk.sizeKeys, diskProgress) * scale : 0;
			if (ringProgress < 1) for (const ring of wave.rings) {
				const geometry = resolveRingGeometry(ring, ringProgress, scale, this.fxConfig.rings);
				sourceRadius = Math.max(sourceRadius, geometry.radius + geometry.width * .5);
			}
			if (sourceRadius <= 0) continue;
			addRegion(wave.x - sourceRadius, wave.y - sourceRadius, wave.x + sourceRadius, wave.y + sourceRadius, wave, []);
		}
		const trailRadius = Math.max(1, this.fxConfig.trail.geometryWidth * scale * bloomCfg.trailCoverageScale * .5);
		for (const stroke of this.trailStrokes) {
			if (stroke.points.length < 2) continue;
			const trailData = stroke.trailFrameData ?? createTrailFrameData(stroke.points, this.fxConfig.trail, bloomCfg.trailEmission);
			const emissionQuantizationScale = this._getEffectiveOpacity() * (this.fxConfig.trail.trailOpacity ?? 1) * bloomCfg.trailEmissionAlpha / Math.max(1, bloomCfg.emissionRange) * 255;
			const bloomRuns = [];
			let activeRun = null;
			for (let index = 1; index < stroke.points.length; index++) {
				if (trailData.segmentMaximumEnergies[index - 1] * emissionQuantizationScale < .5) {
					if (activeRun) {
						bloomRuns.push(activeRun);
						activeRun = null;
					}
					continue;
				}
				const previousPoint = stroke.points[index - 1];
				const point = stroke.points[index];
				if (!activeRun) {
					activeRun = {
						firstSegment: index,
						lastSegment: index,
						minimumX: Math.min(previousPoint.x, point.x),
						minimumY: Math.min(previousPoint.y, point.y),
						maximumX: Math.max(previousPoint.x, point.x),
						maximumY: Math.max(previousPoint.y, point.y)
					};
					continue;
				}
				activeRun.lastSegment = index;
				activeRun.minimumX = Math.min(activeRun.minimumX, previousPoint.x, point.x);
				activeRun.minimumY = Math.min(activeRun.minimumY, previousPoint.y, point.y);
				activeRun.maximumX = Math.max(activeRun.maximumX, previousPoint.x, point.x);
				activeRun.maximumY = Math.max(activeRun.maximumY, previousPoint.y, point.y);
			}
			if (activeRun) bloomRuns.push(activeRun);
			if (bloomRuns.length > 0) {
				const minimumX = Math.min(...bloomRuns.map((run) => run.minimumX));
				const minimumY = Math.min(...bloomRuns.map((run) => run.minimumY));
				const maximumX = Math.max(...bloomRuns.map((run) => run.maximumX));
				const maximumY = Math.max(...bloomRuns.map((run) => run.maximumY));
				addRegion(minimumX - trailRadius, minimumY - trailRadius, maximumX + trailRadius, maximumY + trailRadius, null, bloomRuns.map((run) => ({
					stroke,
					firstSegment: run.firstSegment,
					lastSegment: run.lastSegment
				})));
			}
		}
		for (const shard of this.shards) {
			const shardCfg = this.fxConfig.shards;
			const progress = clamp01(shard.ageMs / shard.lifetimeMs);
			const size = shard.size * evaluateUnityHermiteCurve(shardCfg.sizeKeys, progress) * scale;
			if (size <= 0) continue;
			addRegion(shard.x - size, shard.y - size, shard.x + size, shard.y + size, null, [], [shard]);
		}
		if (regions.length === 0) return [];
		return [{
			x: 0,
			y: 0,
			width: this.width,
			height: this.height,
			emissionBounds: combineBloomRegionBounds(regions.map((region) => region.emissionBounds)),
			waves: regions.flatMap((region) => region.waves),
			trailBatches: regions.flatMap((region) => region.trailBatches),
			shards: regions.flatMap((region) => region.shards)
		}];
	}
	_getCanvasOverlayBounds(scale) {
		const bounds = [];
		const addBounds = (minimumX, minimumY, maximumX, maximumY) => {
			if (!Number.isFinite(minimumX) || !Number.isFinite(minimumY) || !Number.isFinite(maximumX) || !Number.isFinite(maximumY) || maximumX < minimumX || maximumY < minimumY) return;
			bounds.push({
				x: minimumX,
				y: minimumY,
				width: maximumX - minimumX,
				height: maximumY - minimumY
			});
		};
		const bloomCfg = this.fxConfig.bloom;
		for (const wave of this.waves) {
			let radius = 0;
			const hitProgress = wave.ageMs / wave.fx.hit.lifetimeMs;
			const flareProgress = wave.ageMs / wave.fx.flare.lifetimeMs;
			const diskProgress = wave.ageMs / wave.fx.disk.lifetimeMs;
			const ringProgress = wave.ageMs / wave.fx.rings.lifetimeMs;
			if (wave.fx.hit.enabled && hitProgress < 1) radius = Math.max(radius, wave.fx.hit.radius * scale);
			if (wave.fx.flare.enabled && flareProgress < 1) radius = Math.max(radius, wave.fx.flare.radius * scale);
			if (diskProgress < 1) {
				const diskRadius = wave.fx.disk.radius * evaluateUnityHermiteCurve(wave.fx.disk.sizeKeys, diskProgress) * scale;
				const diskBlur = bloomCfg.diskAlpha > 0 ? bloomCfg.diskBlur * scale * 3 : 0;
				radius = Math.max(radius, diskRadius + diskBlur);
			}
			if (ringProgress < 1) {
				const ringBlur = bloomCfg.ringAlpha > 0 ? bloomCfg.ringBlur * scale * 3 : 0;
				for (const ring of wave.rings) {
					const geometry = resolveRingGeometry(ring, ringProgress, scale, wave.fx.rings);
					radius = Math.max(radius, geometry.radius + geometry.width * .5 + ringBlur);
				}
			}
			if (radius > 0) addBounds(wave.x - radius, wave.y - radius, wave.x + radius, wave.y + radius);
		}
		for (const shard of this.shards) {
			const progress = clamp01(shard.ageMs / shard.lifetimeMs);
			const size = shard.size * evaluateUnityHermiteCurve(this.fxConfig.shards.sizeKeys, progress) * scale;
			if (size > 0) addBounds(shard.x - size, shard.y - size, shard.x + size, shard.y + size);
		}
		const trailCfg = this.fxConfig.trail;
		const trailMargin = Math.max(trailCfg.width * scale * .5, trailCfg.outerGlowWidth * scale * 3 + 2);
		for (const stroke of this.trailStrokes) {
			if (stroke.points.length < 2) continue;
			let minimumX = Infinity;
			let minimumY = Infinity;
			let maximumX = -Infinity;
			let maximumY = -Infinity;
			for (const point of stroke.points) {
				minimumX = Math.min(minimumX, point.x);
				minimumY = Math.min(minimumY, point.y);
				maximumX = Math.max(maximumX, point.x);
				maximumY = Math.max(maximumY, point.y);
			}
			addBounds(minimumX - trailMargin, minimumY - trailMargin, maximumX + trailMargin, maximumY + trailMargin);
		}
		return combineBloomRegionBounds(bounds);
	}
	_getCanvasOverlayPixelBounds(scale) {
		const bounds = this._getCanvasOverlayBounds(scale);
		if (!bounds) return null;
		const minimumX = Math.max(0, Math.floor(bounds.x * this.dpr));
		const minimumY = Math.max(0, Math.floor(bounds.y * this.dpr));
		const maximumX = Math.min(this.canvas.width, Math.ceil((bounds.x + bounds.width) * this.dpr));
		const maximumY = Math.min(this.canvas.height, Math.ceil((bounds.y + bounds.height) * this.dpr));
		return {
			minimumX,
			minimumY,
			maximumX,
			maximumY,
			width: Math.max(0, maximumX - minimumX),
			height: Math.max(0, maximumY - minimumY)
		};
	}
	_captureCanvasOverlayAlpha(scale) {
		if (this._getOverlayAlphaPolicy() !== "visual-max" || typeof this.context?.getImageData !== "function") return null;
		const bounds = this._getCanvasOverlayPixelBounds(scale);
		if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
		try {
			return {
				...bounds,
				data: this.context.getImageData(bounds.minimumX, bounds.minimumY, bounds.width, bounds.height).data
			};
		} catch {
			return null;
		}
	}
	_prepareCanvasBloomTransportContext() {
		if (this._getOverlayAlphaPolicy() !== "visual-max") return null;
		if (!this.canvasBloomTransportCanvas) {
			const canvas = createCanvas();
			const context = canvas?.getContext?.("2d", {
				alpha: true,
				willReadFrequently: true
			});
			if (!canvas || !context) return null;
			this.canvasBloomTransportCanvas = canvas;
			this.canvasBloomTransportContext = context;
		}
		const canvas = this.canvasBloomTransportCanvas;
		const context = this.canvasBloomTransportContext;
		if (canvas.width !== this.canvas.width || canvas.height !== this.canvas.height) {
			canvas.width = this.canvas.width;
			canvas.height = this.canvas.height;
		}
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		context.globalCompositeOperation = "lighter";
		return context;
	}
	_limitCanvasOverlayAlpha(scale, sceneAlphaSnapshot = null, bloomTransportContext = null, bloomCompositing = "lighter", applyColorCompensation = true) {
		const overlayAlphaPolicy = this._getOverlayAlphaPolicy();
		const overlayColorCompensation = this._getOverlayColorCompensation();
		const overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit();
		const compensateBrightCore = overlayColorCompensation === "bright-core";
		const adjustAlpha = overlayAlphaPolicy === "visual-max" || overlayAlphaLimit < 1;
		if (!this._usesUnknownBrowserOverlay() || this._usesIndependentHostPayload() || !adjustAlpha && !compensateBrightCore || this.webgpuEffectVisible || this.webglEffectVisible || this.webglBloomVisible || this.canvasSceneVisible || this.ownsCanvas && this.canvas.style.visibility === "hidden") return;
		const bounds = this._getCanvasOverlayPixelBounds(scale);
		if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
		try {
			const imageData = this.context.getImageData(bounds.minimumX, bounds.minimumY, bounds.width, bounds.height);
			if (overlayAlphaPolicy === "visual-max") applyOverlayAlphaPolicyToImageData(imageData, sceneAlphaSnapshot && sceneAlphaSnapshot.minimumX === bounds.minimumX && sceneAlphaSnapshot.minimumY === bounds.minimumY && sceneAlphaSnapshot.width === bounds.width && sceneAlphaSnapshot.height === bounds.height ? sceneAlphaSnapshot.data : null, bloomTransportContext ? bloomTransportContext.getImageData(bounds.minimumX, bounds.minimumY, bounds.width, bounds.height).data : null, overlayAlphaLimit, overlayAlphaPolicy, bloomCompositing);
			else if (overlayAlphaLimit < 1) {
				const maximumAlpha = Math.round(clamp01(overlayAlphaLimit) * 255);
				for (let index = 3; index < imageData.data.length; index += 4) imageData.data[index] = Math.min(imageData.data[index], maximumAlpha);
			}
			if (applyColorCompensation) applyOverlayColorCompensationToImageData(imageData, overlayColorCompensation, this._getEffectiveOpacity());
			this.context.putImageData(imageData, bounds.minimumX, bounds.minimumY);
			return;
		} catch {}
		if (overlayAlphaPolicy === "visual-max") return;
		limitCanvasAlpha(this.context, {
			minimumX: bounds.minimumX,
			minimumY: bounds.minimumY,
			maximumX: bounds.maximumX - 1,
			maximumY: bounds.maximumY - 1
		}, overlayAlphaLimit);
	}
	_getSoftwareBloomFrameSignature(scale) {
		const trailSignature = this.trailStrokes.map((stroke) => {
			const first = stroke.points[0];
			const last = stroke.points.at(-1);
			return [
				stroke.points.length,
				first?.x,
				first?.y,
				first?.bornAt,
				last?.x,
				last?.y,
				last?.bornAt
			].join(",");
		}).join("|");
		const waveSignature = this.waves.map((wave) => [
			wave.x,
			wave.y,
			wave.ageMs,
			wave.diskRotation,
			...wave.rings.flatMap((ring) => [
				ring.radius,
				ring.rotation,
				ring.angularVelocity
			])
		].join(",")).join("|");
		const shardSignature = this.shards.map((shard) => [
			shard.kind,
			shard.x,
			shard.y,
			shard.ageMs,
			shard.rotation,
			shard.size,
			shard.textureFrame
		].join(",")).join("|");
		const bloomCfg = this.fxConfig.bloom;
		const trailCfg = this.fxConfig.trail;
		return [
			this.width,
			this.height,
			this.dpr,
			scale,
			this.clickTimeMs,
			this.trailTimeMs,
			this._getEffectiveOpacity(),
			this.config.outputCompositing,
			this._getOverlayColorCompensation(),
			this._getEffectiveOverlayAlphaLimit(),
			this._getEffectiveHostCompositing(),
			this.compositingReferenceSource === null ? "unknown" : "known",
			this.config.themeColorMode,
			this.config.themeColor,
			this._themeHueShift,
			bloomCfg.threshold,
			bloomCfg.softKnee,
			bloomCfg.intensity,
			bloomCfg.diffusion,
			bloomCfg.resolutionScale,
			bloomCfg.trailEmission,
			bloomCfg.trailEmissionAlpha,
			trailCfg.width,
			trailCfg.geometryWidth,
			JSON.stringify(this.fxConfig),
			trailSignature,
			waveSignature,
			shardSignature
		].join(":");
	}
	_cacheSoftwareBloomFrame(scale) {
		if (this.config.outputCompositing !== "browser-overlay" || this.canvas.width <= 0 || this.canvas.height <= 0) return;
		const previousCanvas = this.lastSoftwareBloomFrame?.canvas;
		const canvas = previousCanvas && previousCanvas !== this.canvas ? previousCanvas : createCanvas();
		const context = canvas.getContext?.("2d", { alpha: true });
		if (!context) {
			this.lastSoftwareBloomFrame = null;
			return;
		}
		try {
			if (canvas.width !== this.canvas.width || canvas.height !== this.canvas.height) {
				canvas.width = this.canvas.width;
				canvas.height = this.canvas.height;
			}
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(this.canvas, 0, 0, this.canvas.width, this.canvas.height, 0, 0, canvas.width, canvas.height);
		} catch {
			this.lastSoftwareBloomFrame = null;
			return;
		}
		this.lastSoftwareBloomFrame = {
			canvas,
			height: canvas.height,
			signature: this._getSoftwareBloomFrameSignature(scale),
			width: canvas.width
		};
	}
	_drawCachedSoftwareBloomFrame(scale) {
		const frame = this.lastSoftwareBloomFrame;
		if (!frame?.canvas || frame.signature !== this._getSoftwareBloomFrameSignature(scale)) return false;
		try {
			this.context.save();
			this.context.setTransform(1, 0, 0, 1, 0, 0);
			this.context.globalAlpha = 1;
			this.context.globalCompositeOperation = "copy";
			this.context.drawImage(frame.canvas, 0, 0, frame.width, frame.height, 0, 0, this.canvas.width, this.canvas.height);
			this.context.restore();
			return true;
		} catch {
			this.context.restore();
			return false;
		}
	}
	_hasCachedSoftwareBloomFrame(scale) {
		return this.config.outputCompositing === "browser-overlay" && this.lastSoftwareBloomFrame?.canvas !== void 0 && this.lastSoftwareBloomFrame.signature === this._getSoftwareBloomFrameSignature(scale);
	}
	_renderSoftwareBloom(scale) {
		const bloomCfg = this.fxConfig.bloom;
		const diffusion = bloomCfg.diffusion;
		const regions = this._getSoftwareBloomRegions(scale);
		const combinedBounds = combineBloomRegionBounds(regions);
		const sceneAlphaSnapshot = this._captureCanvasOverlayAlpha(scale);
		const bloomTransportContext = this._prepareCanvasBloomTransportContext();
		const settings = {
			encodingRange: bloomCfg.emissionRange,
			threshold: bloomCfg.threshold,
			softKnee: bloomCfg.softKnee,
			clamp: bloomCfg.clamp,
			intensity: bloomCfg.intensity,
			diffusion,
			opacity: this._getEffectiveOpacity(),
			outputCompositing: this.config.outputCompositing,
			overlayColorCompensation: "none",
			overlayAlphaPolicy: this._getOverlayAlphaPolicy(),
			overlayAlphaLimit: this._getEffectiveOverlayAlphaLimit(),
			hostCompositing: this._getEffectiveHostCompositing(),
			enforceOverlayAlphaLimit: this._usesUnknownBrowserOverlay()
		};
		let processedSourcePixels = 0;
		let failed = false;
		for (let index = 0; index < regions.length; index++) {
			const region = regions[index];
			const renderer = this._getBloomRenderer(index);
			const bloomContext = renderer.beginFrame(this.width, this.height, bloomCfg.resolutionScale, region, diffusion, this.dpr, region.emissionBounds);
			if (!bloomContext) {
				if (!renderer.available) {
					this.bloomRenderer.available = false;
					failed = true;
				}
				continue;
			}
			const coverageContext = renderer.beginCoverageFrame(this.config.outputCompositing);
			processedSourcePixels += renderer.sourceWidth * renderer.sourceHeight;
			bloomContext.save();
			for (const batch of region.trailBatches) {
				const stroke = batch.stroke;
				if (stroke.points.length >= 2) drawTrailEmission(bloomContext, stroke.points, scale, this._getEffectiveOpacity(), this.fxConfig, stroke.trailFrameData, batch.firstSegment, batch.lastSegment);
			}
			for (const wave of region.waves) wave.drawBloom(bloomContext, scale, this._getEffectiveOpacity());
			for (const shard of region.shards) shard.drawBloom(bloomContext, scale, this._getEffectiveOpacity(), this.fxConfig);
			bloomContext.restore();
			if (coverageContext) {
				coverageContext.save();
				for (const batch of region.trailBatches) {
					const stroke = batch.stroke;
					if (stroke.points.length >= 2) drawTrailCoverage(coverageContext, stroke.points, scale, this._getEffectiveOpacity(), this.fxConfig, stroke.trailFrameData, batch.firstSegment, batch.lastSegment);
				}
				for (const wave of region.waves) wave.drawBloomCoverage(coverageContext, scale, this._getEffectiveOpacity());
				for (const shard of region.shards) shard.drawBloomCoverage(coverageContext, scale, this._getEffectiveOpacity(), this.fxConfig);
				coverageContext.restore();
			}
			let compositeSucceeded = false;
			this.context.save();
			try {
				if (this.config.outputCompositing === "browser-overlay") this.context.globalCompositeOperation = "lighter";
				compositeSucceeded = renderer.composite(this.context, settings);
				if (compositeSucceeded && bloomTransportContext) renderer.drawCurrentOutput(bloomTransportContext);
			} finally {
				this.context.restore();
			}
			if (!compositeSucceeded) {
				this.bloomRenderer.available = false;
				failed = true;
			}
		}
		if (!failed) {
			this._limitCanvasOverlayAlpha(scale, sceneAlphaSnapshot, bloomTransportContext, "lighter", false);
			this._cacheSoftwareBloomFrame(scale);
		}
		this.softwareBloomFrameStats = {
			regionCount: regions.length,
			processedSourcePixels,
			combinedBoundsPixels: combinedBounds ? Math.max(1, Math.round(combinedBounds.width * this.dpr)) * Math.max(1, Math.round(combinedBounds.height * this.dpr)) : 0
		};
		this._trimBloomRendererPool(regions.length);
		if (failed) {
			const hasCachedSoftwareBloom = this._hasCachedSoftwareBloomFrame(scale);
			this._drawCanvasFallbackFrame(scale, true, false);
			if (hasCachedSoftwareBloom) {
				this._drawCanvasFallbackFrame(scale, false, false);
				if (!this._drawCachedSoftwareBloomFrame(scale)) this._drawCanvasFallbackFrame(scale, true, false);
			}
			this._renderLightBackgroundContrast(scale, false);
			this._setResolvedBloomBackend("native");
		}
	}
	_renderWebGL2Scene(renderer, scale) {
		const bloomCfg = this.fxConfig.bloom;
		if (!renderer?.available || renderer.contextLost) return false;
		if (!this.trailStrokes.some((stroke) => stroke.points.length >= 2) && this.waves.length === 0 && this.shards.length === 0) {
			renderer.clear();
			return true;
		}
		try {
			renderer.beginFrame();
			for (const stroke of this.trailStrokes) {
				if (stroke.points.length < 2) continue;
				appendTrailWebGLScene(renderer, stroke.points, scale, this._getEffectiveOpacity(), this.fxConfig, stroke.trailFrameData);
			}
			for (const wave of this.waves) wave.appendWebGLSceneDiskLayer(renderer, scale, this._getEffectiveOpacity());
			for (const shard of this.shards) shard.appendWebGLScene(renderer, scale, this._getEffectiveOpacity(), this.fxConfig);
			for (const wave of this.waves) wave.appendWebGLSceneAdditiveLayer(renderer, scale, this._getEffectiveOpacity());
			if (!renderer.renderScene({
				outputCompositing: this.config.outputCompositing,
				hostCompositing: this._getEffectiveHostCompositing(),
				diskEmissionScale: bloomCfg.clickEmissionScale * bloomCfg.diskEmissionAlpha,
				ringEmissionScale: bloomCfg.clickEmissionScale * bloomCfg.ringEmissionAlpha
			})) return false;
			renderer.beginFrame({ preserveSceneStats: true });
			const rendered = renderer.render({
				threshold: bloomCfg.threshold,
				softKnee: bloomCfg.softKnee,
				clamp: bloomCfg.clamp,
				intensity: bloomCfg.intensity,
				diffusion: bloomCfg.diffusion,
				opacity: this._getEffectiveOpacity(),
				outputCompositing: this.config.outputCompositing,
				overlayColorCompensation: this._getOverlayColorCompensation(),
				overlayAlphaPolicy: this._getOverlayAlphaPolicy(),
				overlayAlphaLimit: this._getEffectiveOverlayAlphaLimit(),
				hostCompositing: this._getEffectiveHostCompositing(),
				webgpuHdrPeak: this.config.webgpuHdrPeak,
				webgpuHdrBrightness: this.config.webgpuHdrBrightness,
				webgpuHdrColorPreservation: this.config.webgpuHdrColorPreservation,
				webgpuHdrWhiteCore: this.config.webgpuHdrWhiteCore,
				webgpuHdrWhiteStart: this.config.webgpuHdrWhiteStart,
				webgpuHdrWhiteEnd: this.config.webgpuHdrWhiteEnd
			}, { preserveCanvas: true });
			this.webglBloomFrameStats = {
				available: renderer.available,
				...renderer.stats
			};
			return rendered;
		} catch (error) {
			console.warn("[BAClickFX] WebGL2 Scene 渲染失败:", error);
			renderer.clear();
			return false;
		}
	}
	_renderWebGL2ClickEffects(scale) {
		return this._renderWebGL2Scene(this.webglEffectRenderer, scale);
	}
	_renderGPUClickEffects(backend, scale) {
		if (backend === "webgl2") return this._renderWebGL2ClickEffects(scale);
		return this._renderWebGL2Scene(this.webgpuEffectRenderer, scale);
	}
	_clearLightBackgroundContrast() {
		if (!this.contrastContext) return;
		this.contrastContext.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		this.contrastContext.clearRect(0, 0, this.width, this.height);
	}
	_renderCanvasSceneEffects(scale, useNativeBloom) {
		const renderer = this.canvasSceneRenderer;
		if (!renderer?.available || renderer.contextLost) return false;
		try {
			renderer.beginFrame();
			this.context.globalCompositeOperation = "lighter";
			this._drawCanvasTrails(scale, useNativeBloom, true);
			for (const wave of this.waves) {
				wave.drawDiskLayer(this.context, scale, this._getEffectiveOpacity(), false, this.dpr);
				wave.appendCanvasSceneCoverage(renderer, scale, this._getEffectiveOpacity());
			}
			if (useNativeBloom) for (const wave of this.waves) wave.drawDiskGlow(this.context, scale, this._getEffectiveOpacity(), this.dpr);
			for (const shard of this.shards) shard.draw(this.context, scale, this._getEffectiveOpacity(), this.fxConfig);
			for (const wave of this.waves) wave.drawAdditiveBase(this.context, scale, this._getEffectiveOpacity(), true);
			this._drawWaveRings(scale, useNativeBloom, true, "scene", "coverage", 1);
			return renderer.render(this.canvas);
		} catch (error) {
			console.warn("[BAClickFX] Canvas Scene Final Pass 渲染失败:", error);
			renderer.clear();
			return false;
		}
	}
	_drawCanvasFallbackPass(scale, useNativeBloom) {
		this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		this.context.clearRect(0, 0, this.width, this.height);
		this.context.globalCompositeOperation = this._getCanvasOutputCompositing() === "browser-overlay" ? "source-over" : "lighter";
		this._drawCanvasTrails(scale, useNativeBloom);
		this._drawCanvasClickEffects(scale, useNativeBloom);
	}
	_drawCanvasFallbackFrame(scale, useNativeBloom) {
		this.canvasNativeSceneAlphaSnapshot = null;
		if (useNativeBloom && this._usesUnknownBrowserOverlay() && !this._usesIndependentHostPayload() && this._getOverlayAlphaPolicy() === "visual-max") {
			this._drawCanvasFallbackPass(scale, false);
			this.canvasNativeSceneAlphaSnapshot = this._captureCanvasOverlayAlpha(scale);
		}
		this._drawCanvasFallbackPass(scale, useNativeBloom);
	}
	_finalizeCanvasOverlayAlpha(scale) {
		const sceneAlphaSnapshot = this.canvasNativeSceneAlphaSnapshot;
		this.canvasNativeSceneAlphaSnapshot = null;
		this._limitCanvasOverlayAlpha(scale, sceneAlphaSnapshot, null, sceneAlphaSnapshot ? "source-over" : "lighter");
	}
	_restoreCanvasOutputAfterContextLoss(bloomBackend) {
		const scale = this._getScale();
		const previousHueShift = themeHueShift;
		const previousRelativeOklchTheme = relativeOklchTheme;
		let resolvedBloomBackend = bloomBackend;
		this._setResolvedBloomBackend(resolvedBloomBackend);
		if (this.resolvedBloomBackend === "native") resolvedBloomBackend = "native";
		let contextSaved = false;
		try {
			this.context.save();
			contextSaved = true;
			themeHueShift = this._themeHueShift;
			relativeOklchTheme = this._relativeOklchTheme;
			this._drawCanvasFallbackFrame(scale, resolvedBloomBackend === "native");
			this._renderLightBackgroundContrast(scale, resolvedBloomBackend === "software");
			if (resolvedBloomBackend === "software" && this._hasVisibleEffects()) {
				this._renderSoftwareBloom(scale);
				if (!this.bloomRenderer.available) resolvedBloomBackend = "native";
			}
		} catch (error) {
			console.warn("[BAClickFX] WebGL Context 丢失回退失败:", error);
			resolvedBloomBackend = "native";
			try {
				this._drawCanvasFallbackFrame(scale, true);
				this._renderLightBackgroundContrast(scale, false);
			} catch (fallbackError) {
				console.warn("[BAClickFX] 原生 Canvas 回退失败:", fallbackError);
			}
		} finally {
			themeHueShift = previousHueShift;
			relativeOklchTheme = previousRelativeOklchTheme;
			if (contextSaved) this.context.restore();
		}
		this._finalizeCanvasOverlayAlpha(scale);
		this._setResolvedBloomBackend(resolvedBloomBackend);
		this._setCanvasOutputVisible(true);
		this._flushCompositingMountRefresh();
	}
	_drawCanvasClickEffects(scale, useNativeBloom) {
		const outputCompositing = this._getCanvasOutputCompositing();
		const overlayColorCompensation = "none";
		const overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit();
		for (const wave of this.waves) wave.drawBase(this.context, scale, this._getEffectiveOpacity(), useNativeBloom, outputCompositing, this.dpr, overlayColorCompensation, overlayAlphaLimit);
		for (const shard of this.shards) shard.draw(this.context, scale, this._getEffectiveOpacity(), this.fxConfig, outputCompositing, overlayColorCompensation, overlayAlphaLimit);
		this._drawWaveRings(scale, useNativeBloom, false, outputCompositing, overlayColorCompensation, overlayAlphaLimit);
	}
	_drawCanvasTrails(scale, useNativeBloom, linearOutput = false) {
		const nativeBloomSurface = useNativeBloom ? this._getNativeTrailBloomSurface() : null;
		const outputCompositing = linearOutput ? "scene" : this._getCanvasOutputCompositing();
		const overlayColorCompensation = "none";
		const overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit();
		for (let strokeIndex = this.trailStrokes.length - 1; strokeIndex >= 0; strokeIndex--) {
			const stroke = this.trailStrokes[strokeIndex];
			if (stroke.points.length < 2) continue;
			if (!Array.isArray(stroke.trailFrameData?.segmentEnergies)) stroke.trailFrameData = createTrailFrameData(stroke.points, this.fxConfig.trail, this.fxConfig.bloom.trailEmission);
			drawTrail(this.context, stroke.points, scale, this._getEffectiveOpacity(), this.fxConfig, useNativeBloom, nativeBloomSurface, stroke.trailFrameData, linearOutput, outputCompositing, overlayColorCompensation, overlayAlphaLimit);
		}
	}
	_renderWebGL2Bloom(scale) {
		const renderer = this.webglBloomRenderer;
		if (!renderer || !this._resizeWebGLBloomRenderer()) {
			this._fallbackFromWebGL2(scale);
			return;
		}
		if (!this._renderWebGL2Scene(renderer, scale)) {
			this._fallbackFromWebGL2(scale);
			return;
		}
		this._setWebGLBloomVisible(true);
		this._setCanvasOutputVisible(false);
	}
	_fallbackFromWebGL2(scale) {
		this._setWebGLBloomVisible(false);
		let fallbackBackend = this._resolveCanvasFallbackBloomBackend();
		this._setResolvedBloomBackend(fallbackBackend);
		fallbackBackend = this._resolveCanvasFallbackBloomBackend();
		if (fallbackBackend === "software") {
			this._drawCanvasFallbackFrame(scale, false, false);
			this._renderLightBackgroundContrast(scale, true);
			this._setResolvedBloomBackend("software");
			this._renderSoftwareBloom(scale);
			return;
		}
		this._drawCanvasFallbackFrame(scale, true, false);
		this._renderLightBackgroundContrast(scale, false);
		this._setResolvedBloomBackend("native");
	}
	_updateTrail(trailTimeMs, scale, useNativeBloom, drawCanvas = true, useTexturedWebGL = false) {
		const lifetime = this.fxConfig.trail.lifetimeMs;
		for (let strokeIndex = this.trailStrokes.length - 1; strokeIndex >= 0; strokeIndex--) {
			const stroke = this.trailStrokes[strokeIndex];
			let expiredPointCount = 0;
			while (expiredPointCount < stroke.points.length && trailTimeMs - stroke.points[expiredPointCount].bornAt >= lifetime) expiredPointCount++;
			if (expiredPointCount > 0) stroke.points.splice(0, expiredPointCount);
			if (stroke.points.length >= 2) {
				const materialIntensity = useTexturedWebGL ? null : this.fxConfig.bloom.trailEmission;
				stroke.trailFrameData = createTrailFrameData(stroke.points, this.fxConfig.trail, materialIntensity, true);
			} else stroke.trailFrameData = null;
			if (!stroke.active && stroke.points.length < 2) this.trailStrokes.splice(strokeIndex, 1);
		}
		if (drawCanvas) this._drawCanvasTrails(scale, useNativeBloom);
	}
	_updateWaves(clickTimeMs, scale, useNativeBloom, drawCanvas = true) {
		for (let index = this.waves.length - 1; index >= 0; index--) {
			const wave = this.waves[index];
			wave.updateTo(clickTimeMs);
			if (wave.dead) {
				this.waves.splice(index, 1);
				continue;
			}
			if (drawCanvas) {
				const outputCompositing = this._getCanvasOutputCompositing();
				wave.drawBase(this.context, scale, this._getEffectiveOpacity(), useNativeBloom, outputCompositing, this.dpr, "none", this._getEffectiveOverlayAlphaLimit());
			}
		}
	}
	_drawWaveRings(scale, useNativeBloom, linearNativeGlow = false, outputCompositing = this._getCanvasOutputCompositing(), overlayColorCompensation = "none", overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit()) {
		for (const wave of this.waves) wave.drawRings(this.context, scale, this._getEffectiveOpacity(), useNativeBloom, this.dpr, outputCompositing, linearNativeGlow, overlayColorCompensation, overlayAlphaLimit);
	}
	_updateShards(clickTimeMs, trailTimeMs, scale, drawCanvas = true) {
		for (let index = this.shards.length - 1; index >= 0; index--) {
			const shard = this.shards[index];
			if (shard.kind === "trail") shard.updateTo(trailTimeMs);
			else shard.updateTo(clickTimeMs);
			if (shard.dead) {
				this._releaseTrailShardOwner(shard);
				this.shards.splice(index, 1);
				continue;
			}
			if (drawCanvas) {
				const outputCompositing = this._getCanvasOutputCompositing();
				shard.draw(this.context, scale, this._getEffectiveOpacity(), this.fxConfig, outputCompositing, "none", this._getEffectiveOverlayAlphaLimit());
			}
		}
	}
	_hasVisibleEffects() {
		return this.waves.length > 0 || this.shards.length > 0 || this.trailStrokes.some((stroke) => hasVisibleTrailPoints(stroke.points));
	}
	/** 在 Canvas 局部坐标触发一次 FX_Touch 点击粒子。 */
	boom(x = this.width / 2, y = this.height / 2) {
		if (this.destroyed || this.paused || !this.config.clickEnabled) return;
		this._spawnClick(clamp(Number(x) || 0, 0, this.width), clamp(Number(y) || 0, 0, this.height));
		this._requestRender();
	}
	/** 暂停或恢复输入与动画调度；clear 仅在进入暂停时生效。 */
	setPaused(paused, options = {}) {
		if (this.destroyed) return;
		if (paused === true) {
			if (!this.paused) {
				const pauseTime = performance.now();
				this._advanceClickTime(pauseTime);
				this._advanceTrailTime(pauseTime);
				this.paused = true;
				this.touchGestureStarts.clear();
				this.touchPointerFilterResults.length = 0;
				this.closedShadowPointerDecisions = /* @__PURE__ */ new WeakMap();
				if (this.activePointerId !== null) this._releaseActivePointer();
				if (this.animationFrame !== null) {
					cancelRenderFrame(this.animationFrame);
					this.animationFrame = null;
				}
				this.lastFrameTime = null;
				this.lastClickTimeSource = null;
				this.lastTrailTimeSource = null;
			}
			if (options?.clear === true) this.clear();
			return;
		}
		if (!this.paused) return;
		const resumeTime = performance.now();
		this.paused = false;
		this.lastFrameTime = null;
		this.lastClickTimeSource = resumeTime;
		this.lastTrailTimeSource = resumeTime;
		if (this._hasVisibleEffects()) this._requestRender();
		else this._flushCompositingMountRefresh();
	}
	/**
	* 设置主题色；具体映射由 themeColorMode 决定。
	* 传入空字符串或无效值可恢复默认蓝色。
	* @param {string} hex — CSS 十六进制颜色，如 "#ff6969"
	*/
	setThemeColor(hex) {
		if (this.destroyed) return;
		this._applyThemeColor(hex);
		this._requestRender();
	}
	_applyThemeColor(hex) {
		const themeColor = normalizeThemeColor(hex, DEFAULT_THEME_COLOR);
		this.config.themeColor = themeColor;
		this._themeHueShift = computeThemeHueShift(themeColor);
		this._relativeOklchTheme = this.config.themeColorMode === "relative-oklch" ? createRelativeOklchTheme(themeColor) : null;
	}
	/** 切换主题颜色映射；合法值即视为已接受，包括与当前模式相同。 */
	setThemeColorMode(mode) {
		if (this.destroyed || !isThemeColorMode(mode)) return false;
		this.config.themeColorMode = mode;
		this._relativeOklchTheme = mode === "relative-oklch" ? createRelativeOklchTheme(this.config.themeColor) : null;
		this._requestRender();
		return true;
	}
	/** 设置移动输入采样率上限；0 表示保留全部输入样本。 */
	setInputSamplingRate(rateHz) {
		if (this.destroyed || !isInputSamplingRate(rateHz)) return false;
		this.updateConfig({ inputSamplingRate: rateHz });
		return true;
	}
	/**
	* 运行时更新部分配置，无需销毁重建实例。
	* target 与 inputFilter 只在构造时生效；直接 OffscreenCanvas 的 context
	* 类型也在构造时固定，不兼容的后端与渲染模式切换会明确失败。
	* @param {object} overrides
	* @returns {object}
	*/
	updateConfig(overrides = {}) {
		if (this.destroyed) throw new Error("BAClickFX 实例已销毁");
		assertConfigOverrides(overrides, { fallback: this.config });
		const previousEffectBackend = this.config.effectBackend;
		const previousWebGPUPreferHdr = this.config.webgpuPreferHdr;
		const previousBloomBackend = this.config.bloomBackend;
		const previousOutputCompositing = this.config.outputCompositing;
		const previousHostCompositing = this.config.hostCompositing;
		const previousHostCompositingSurface = this.config.hostCompositingSurface;
		const nextOffscreenContextType = (isEffectBackend(overrides.effectBackend) ? overrides.effectBackend : this.config.effectBackend) === "canvas2d" ? "2d" : "webgl2";
		const canChangeOffscreenRoute = this._directOffscreenContextType === null || this._directOffscreenContextType === nextOffscreenContextType;
		if (!canChangeOffscreenRoute && overrides.effectBackend !== void 0) throw new Error("BAClickFX 无法切换 OffscreenCanvas context 类型；请销毁实例并使用新的画布");
		let transparentContractChanged = false;
		if (isInputSource(overrides.inputSource) && overrides.inputSource !== this.config.inputSource) {
			this._cancelPointer();
			this.config.inputSource = overrides.inputSource;
			if (overrides.inputSource === "dom") this._attachDomPointerListeners();
			else this._detachDomPointerListeners();
		}
		if (isInputSamplingRate(overrides.inputSamplingRate) && overrides.inputSamplingRate !== this.config.inputSamplingRate) {
			this.config.inputSamplingRate = overrides.inputSamplingRate;
			this.lastInputSampleSourceTime = null;
		}
		if (isTimeScale(overrides.clickTimeScale)) {
			this._advanceClickTime();
			this.config.clickTimeScale = overrides.clickTimeScale;
		}
		if (isTimeScale(overrides.trailTimeScale)) {
			this._advanceTrailTime();
			this.config.trailTimeScale = overrides.trailTimeScale;
		}
		if (Number.isFinite(overrides.scale)) this.config.scale = Math.max(.01, overrides.scale);
		if (Number.isFinite(overrides.opacity)) this.config.opacity = clamp01(overrides.opacity);
		if (isThemeColorMode(overrides.themeColorMode)) this.config.themeColorMode = normalizeThemeColorMode(overrides.themeColorMode, DEFAULT_THEME_COLOR_MODE);
		if (overrides.themeColor !== void 0 || isThemeColorMode(overrides.themeColorMode)) this._applyThemeColor(overrides.themeColor === void 0 ? this.config.themeColor : overrides.themeColor);
		if (isOutputCompositing(overrides.outputCompositing)) {
			transparentContractChanged = transparentContractChanged || overrides.outputCompositing !== this.config.outputCompositing;
			this.config.outputCompositing = overrides.outputCompositing;
		}
		if (isOverlayAlphaPolicy(overrides.overlayAlphaPolicy)) {
			const overlayAlphaPolicy = normalizeOverlayAlphaPolicyConfig(overrides.overlayAlphaPolicy, this.config.overlayAlphaPolicy);
			transparentContractChanged = transparentContractChanged || overlayAlphaPolicy !== this.config.overlayAlphaPolicy;
			this.config.overlayAlphaPolicy = overlayAlphaPolicy;
		}
		if (isOverlayColorCompensation(overrides.overlayColorCompensation)) {
			const overlayColorCompensation = normalizeOverlayColorCompensationConfig(overrides.overlayColorCompensation, this.config.overlayColorCompensation);
			transparentContractChanged = transparentContractChanged || overlayColorCompensation !== this.config.overlayColorCompensation;
			this.config.overlayColorCompensation = overlayColorCompensation;
		}
		if (Number.isFinite(overrides.overlayAlphaLimit)) {
			const overlayAlphaLimit = normalizeOverlayAlphaLimit(overrides.overlayAlphaLimit, this.config.overlayAlphaLimit);
			transparentContractChanged = transparentContractChanged || overlayAlphaLimit !== this.config.overlayAlphaLimit;
			this.config.overlayAlphaLimit = overlayAlphaLimit;
		}
		if (isHostCompositing(overrides.hostCompositing)) {
			transparentContractChanged = transparentContractChanged || overrides.hostCompositing !== this.config.hostCompositing;
			this.config.hostCompositing = overrides.hostCompositing;
		}
		if (isHostCompositingSurface(overrides.hostCompositingSurface)) {
			transparentContractChanged = transparentContractChanged || overrides.hostCompositingSurface !== this.config.hostCompositingSurface;
			this.config.hostCompositingSurface = overrides.hostCompositingSurface;
		}
		if (typeof overrides.clickEnabled === "boolean") this.config.clickEnabled = overrides.clickEnabled;
		if (typeof overrides.trailEnabled === "boolean") {
			this.config.trailEnabled = overrides.trailEnabled;
			if (!overrides.trailEnabled) {
				if (this.activePointerSource === "hover") this._releaseActivePointer();
				this.clearTrail();
			}
		}
		if (typeof overrides.trailAlways === "boolean") {
			if (!overrides.trailAlways && this.activePointerSource === "hover") this._releaseActivePointer();
			this.config.trailAlways = overrides.trailAlways;
		}
		if (isEffectBackend(overrides.effectBackend) && canChangeOffscreenRoute) this.config.effectBackend = overrides.effectBackend;
		if (typeof overrides.webgpuPreferHdr === "boolean") this.config.webgpuPreferHdr = overrides.webgpuPreferHdr;
		if (overrides.webgpuHdrPeak !== void 0 || overrides.webgpuHdrBrightness !== void 0 || overrides.webgpuHdrColorPreservation !== void 0 || overrides.webgpuHdrWhiteCore !== void 0 || overrides.webgpuHdrWhiteStart !== void 0 || overrides.webgpuHdrWhiteEnd !== void 0) Object.assign(this.config, normalizeWebGPUHdrPresentation(overrides, this.config));
		if (isBloomBackend(overrides.bloomBackend)) this.config.bloomBackend = overrides.bloomBackend;
		const webgpuPresentationChanged = previousWebGPUPreferHdr !== this.config.webgpuPreferHdr && (previousEffectBackend === "webgpu" || previousEffectBackend === "auto" || this.config.effectBackend === "webgpu" || this.config.effectBackend === "auto");
		const effectRouteChanged = previousEffectBackend !== this.config.effectBackend || webgpuPresentationChanged;
		const bloomRouteChanged = previousBloomBackend !== this.config.bloomBackend;
		if (effectRouteChanged) {
			if (webgpuPresentationChanged) this.webgpuEffectRenderer?.setPreferHdr(this.config.webgpuPreferHdr);
			if (previousEffectBackend !== this.config.effectBackend && (this.config.effectBackend === "webgpu" || this.config.effectBackend === "auto") && (this.webgpuEffectRenderer?.status === "lost" || this.webgpuEffectRenderer?.status === "unavailable")) {
				this._destroyWebGPUEffectRenderer();
				this.webgpuEffectUnavailable = false;
			}
			this._releaseBackendFrameResources();
			this._setResolvedEffectBackend(this._getRequestedEffectBackendState());
			this._setResolvedBloomBackend(this._getRequestedBloomBackendState());
		} else if (bloomRouteChanged && this.resolvedEffectBackend !== "webgl2" && this.resolvedEffectBackend !== "webgpu") {
			this._releaseBloomBackendFrameResources();
			this._setResolvedBloomBackend(this._getRequestedBloomBackendState());
		}
		if (Number.isFinite(overrides.lightBackgroundContrastAlpha)) this.config.lightBackgroundContrastAlpha = clamp01(overrides.lightBackgroundContrastAlpha);
		if (typeof overrides.isolatedCompositing === "boolean") {
			const isolated = this.ownsCanvas ? overrides.isolatedCompositing : false;
			if (isolated !== this.config.isolatedCompositing) this.config.isolatedCompositing = isolated;
		}
		if (previousOutputCompositing !== this.config.outputCompositing || previousHostCompositing !== this.config.hostCompositing || previousHostCompositingSurface !== this.config.hostCompositingSurface) this._requestCompositingMountRefresh();
		else if (typeof overrides.isolatedCompositing === "boolean") this._applyCompositingMount();
		if (transparentContractChanged) this.lastSoftwareBloomFrame = null;
		if (Number.isFinite(overrides.maxDpr)) {
			this.config.maxDpr = Math.max(1, overrides.maxDpr);
			this._resize();
		}
		if (overrides.touchAction !== void 0) {
			this.config.touchAction = overrides.touchAction;
			if (this.canvas.style) this.canvas.style.touchAction = overrides.touchAction;
			this._syncTouchActionListeners();
		}
		this._requestRender();
		return this.getConfig();
	}
	setFxParams(patch, options = {}) {
		if (this.destroyed) return {
			applied: [],
			normalized: [],
			rejected: [{
				path: "$instance",
				value: null,
				reason: "destroyed"
			}],
			committed: false,
			schemaVersion: 2
		};
		const { nextConfig, ...result } = applyFxParamPatch$1(patch, {
			baseline: this.fxConfig,
			reset: options.reset === true,
			resetBaseline: this._createFxParamResetBaseline(),
			strict: options.strict === true,
			schemaVersion: options.schemaVersion ?? 2
		});
		if (result.committed) {
			this._commitFxParamConfig(nextConfig);
			this._requestRender();
		}
		return result;
	}
	/**
	* 设置单个特效参数。返回 false 时配置保持不变。
	* @param {string} path — 参数路径
	* @param {number|boolean} value — 新值
	*/
	setFxParam(path, value) {
		const result = this.setFxParams({ [path]: value }, { strict: true });
		return result.committed && result.applied.length === 1;
	}
	/** 设置全部点击与拖尾三角碎片的圆角比例，0 为原形，1 为圆形。 */
	setTriangleRoundness(roundness) {
		return this.setFxParam("shards.roundness", roundness);
	}
	/** @returns {object} 当前完整特效配置的深拷贝 */
	getFxConfig() {
		return structuredClone(this.fxConfig);
	}
	/** 重置所有特效参数为游戏默认值 */
	resetFxConfig() {
		this.setFxParams({}, {
			reset: true,
			strict: true
		});
	}
	/** 清除拖尾顶点和拖拽产生的碎片，不影响仍在播放的点击。 */
	clearTrail() {
		this.trailStrokes.length = 0;
		this.currentTrailStroke = null;
		this.shards = this.shards.filter((shard) => shard.kind !== "trail");
		this.trailShardCounts.clear();
		this.lastInputSampleSourceTime = null;
		if (this.activeTrailOwnerId !== null) this.trailShardCounts.set(this.activeTrailOwnerId, 0);
		this._requestRender();
	}
	/** 立即清除所有视觉对象。 */
	clear() {
		this.waves.length = 0;
		this.shards.length = 0;
		this.trailStrokes.length = 0;
		this.currentTrailStroke = null;
		this.trailShardCounts.clear();
		this.lastInputSampleSourceTime = null;
		this._trimBloomRendererPool(0, 0);
		this.context?.clearRect(0, 0, this.width, this.height);
		this.contrastContext?.clearRect(0, 0, this.width, this.height);
		this.webglBloomRenderer?.clear();
		this.webgpuEffectRenderer?.clear();
		this.webglEffectRenderer?.clear();
		this.canvasSceneRenderer?.clear();
		this._flushCompositingMountRefresh();
	}
	_hasCompositingReference() {
		return this.compositingReferenceSource !== null;
	}
	_applyCompositingReferenceToRenderers(source, fit, previousSource, previousFit, invalidatesVisibleOutput) {
		const entries = [
			{
				name: "WebGPU",
				renderer: this.webgpuEffectRenderer,
				discard: () => {
					this._setWebGPUEffectVisible(false);
					this._destroyWebGPUEffectRenderer();
				}
			},
			{
				name: "纯 WebGL2",
				renderer: this.webglEffectRenderer,
				discard: () => {
					this._setWebGLEffectVisible(false);
					this._destroyWebGLEffectRenderer();
				}
			},
			{
				name: "WebGL2 Bloom",
				renderer: this.webglBloomRenderer,
				discard: () => {
					this._setWebGLBloomVisible(false);
					this._destroyWebGLBloomRenderer();
				}
			},
			{
				name: "Canvas Final Pass",
				renderer: this.canvasSceneRenderer,
				discard: () => {
					this._setCanvasSceneVisible(false);
					this._destroyCanvasSceneRenderer();
				}
			}
		].filter((entry) => entry.renderer);
		const appliedEntries = [];
		let failedEntry = null;
		for (const entry of entries) {
			let accepted = false;
			try {
				accepted = entry.renderer.setCompositingReference(source, { fit });
			} catch (error) {
				console.warn(`[BAClickFX] ${entry.name} 背景更新失败:`, error);
			}
			if (!accepted) {
				failedEntry = entry;
				break;
			}
			appliedEntries.push(entry);
		}
		if (!failedEntry) return true;
		let rollbackFailed = false;
		for (let index = appliedEntries.length - 1; index >= 0; index--) {
			const entry = appliedEntries[index];
			let restored = false;
			try {
				restored = entry.renderer.setCompositingReference(previousSource, { fit: previousFit });
			} catch (error) {
				console.warn(`[BAClickFX] ${entry.name} 背景回滚失败:`, error);
			}
			if (!restored) {
				entry.discard();
				rollbackFailed = true;
			}
		}
		if (rollbackFailed) {
			if (invalidatesVisibleOutput) this._invalidateSceneBackgroundOutputs();
			this._requestRender();
		}
		return false;
	}
	/**
	* 为 GPU Scene 提供特效下方的真实不透明栅格参考；调用方负责解码与 CORS。
	* 资源对象不进入 getConfig()，避免配置快照持有宿主 DOM 生命周期。
	*/
	setCompositingReference(source, options = {}) {
		if (this.destroyed) return false;
		const fit = options.fit ?? "cover";
		if (fit !== "cover") return false;
		if (source !== null && !getCompositingReferenceDimensions(source)) return false;
		const previousSource = this.compositingReferenceSource;
		const previousFit = this.compositingReferenceFit;
		const invalidatesVisibleOutput = this.webgpuEffectVisible || this.webglEffectVisible || this.webglBloomVisible || this.canvasSceneVisible;
		if (!this._applyCompositingReferenceToRenderers(source, fit, previousSource, previousFit, invalidatesVisibleOutput)) return false;
		this.compositingReferenceSource = source;
		this.compositingReferenceFit = fit;
		this.lastSoftwareBloomFrame = null;
		this._requestCompositingMountRefresh();
		if (source !== null) {
			this.webgpuEffectUnavailable = false;
			this.webglEffectUnavailable = false;
			this.webglBloomUnavailable = false;
			this.canvasSceneUnavailable = false;
		}
		if (invalidatesVisibleOutput) {
			this._invalidateSceneBackgroundOutputs();
			this._flushCompositingMountRefresh();
		}
		if (source === null) this.canvasSceneRenderer?.releaseFrameResources();
		this._requestRender();
		return true;
	}
	getConfig() {
		const hostCompositingState = this._resolveHostCompositingState();
		return {
			...this.config,
			...hostCompositingState,
			resolvedEffectBackend: this.resolvedEffectBackend,
			resolvedBloomBackend: this.resolvedBloomBackend,
			resolvedWebGPUOutputMode: this._getResolvedWebGPUOutputMode(),
			unity: structuredClone(UNITY_FX_TOUCH)
		};
	}
	_getResolvedWebGPUOutputMode() {
		const requested = normalizeEffectBackend(this.config.effectBackend);
		if (requested !== "webgpu" && requested !== "auto" || !this.ownsCanvas || !this.overlayParent) return "unavailable";
		const renderer = this.webgpuEffectRenderer;
		if (renderer?.deviceManager.outputMode === "extended") return "extended";
		if (renderer?.deviceManager.outputMode === "standard") return "standard";
		if (renderer?.status === "pending" || renderer?.status === "ready") return "pending";
		if (!this.webgpuEffectUnavailable && (requested === "webgpu" || requested === "auto")) return "pending";
		return "unavailable";
	}
	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		if (typeof window !== "undefined") window.removeEventListener("resize", this._onResize);
		this._detachDomPointerListeners();
		if (typeof window !== "undefined") window.removeEventListener("blur", this._onBlur);
		this.resizeObserver?.disconnect();
		if (this.animationFrame !== null) {
			cancelRenderFrame(this.animationFrame);
			this.animationFrame = null;
		}
		this.clear();
		for (const renderer of this.bloomRenderers) renderer.destroy();
		this._destroyWebGLBloomRenderer();
		this._destroyWebGPUEffectRenderer();
		this._destroyWebGLEffectRenderer();
		this._destroyCanvasSceneRenderer();
		if (this.nativeTrailBloomSurface) {
			this.nativeTrailBloomSurface.canvas.width = 0;
			this.nativeTrailBloomSurface.canvas.height = 0;
			this.nativeTrailBloomSurface = null;
		}
		if (this.canvasBloomTransportCanvas) {
			this.canvasBloomTransportCanvas.width = 0;
			this.canvasBloomTransportCanvas.height = 0;
			this.canvasBloomTransportCanvas = null;
			this.canvasBloomTransportContext = null;
		}
		this.canvasNativeSceneAlphaSnapshot = null;
		if (this.ownsCanvas) {
			this.webglBloomCanvas?.remove();
			this.contrastCanvas?.remove();
			this.canvas.remove();
			this.overlayRoot?.remove();
		}
		this.webglBloomCanvas = null;
		this.webglBloomVisible = false;
		this.canvasSceneCanvas = null;
		this.canvasSceneVisible = false;
		this.compositingReferenceSource = null;
		this.overlayParent = null;
		this.overlayMountParent = null;
		this.overlayRoot = null;
	}
};
/**
* 在不创建渲染实例的情况下迁移并校验持久化参数补丁。
* 内部候选配置树不属于公共契约；宿主只需持久化返回的 applied 项。
*/
function applyFxParamPatch(patch, options = {}) {
	const { nextConfig, ...result } = applyFxParamPatch$1(patch, {
		baseline: UNITY_FX_TOUCH,
		schemaVersion: options.schemaVersion ?? 2,
		strict: options.strict === true
	});
	return result;
}
//#endregion
/**
 * Browser half of the dsh-ba-click-fx client plugin.
 *
 * This file is a *fragment*: it is not imported directly. `scripts/build.mjs`
 * inlines the vendored ba-click-fx ESM bundle (`vendor/ba-click-fx.js`, with its
 * trailing `export { ... }` stripped) and then appends this body inside the
 * lazy-CJS factory of `lib/client.js`. As a result, `BAClickFX` is in scope and
 * `exports`/`module` are the CJS module object the factory returns.
 *
 * On activation it:
 *   1. mounts the full-screen Blue Archive click effect + cursor trail
 *      (`new BAClickFX`),
 *   2. shows a self-contained configuration window: a draggable gear button
 *      (bottom-right by default, position persisted) + a panel that edits the
 *      effect live via `fx.updateConfig()` / `fx.setThemeColor()` and persists
 *      choices in `localStorage`,
 *   3. adapts the window to the host theme through the DSH `--dsw-alias-*`
 *      tokens (light / dark aware, with fallbacks when those tokens are absent),
 *   4. registers teardown through `ctx.effect`, so HMR unload/reload and profile
 *      teardown remove the overlay, the config window and their listeners.
 */

const STORAGE_KEY = 'dsh-ba-click-fx-config'
const UI_STORAGE_KEY = 'dsh-ba-click-fx-ui'

const DEFAULT_CONFIG = Object.freeze({
  // Blue Archive default theme blue (#4ca7ff).
  themeColor: '#4ca7ff',
  themeColorMode: 'relative-oklch',
  // Default rendering chain: full WebGL2, with safe fallbacks.
  effectBackend: 'webgl2',
  bloomBackend: 'webgl2',
  // Both click ring/disk and the cursor trail are enabled by default.
  clickEnabled: true,
  trailEnabled: true,
  trailAlways: true,
  // Keep the page scroll / touch behavior unchanged where possible.
  touchAction: 'auto',
  // Cap devicePixelRatio for predictable GPU cost on the overlay.
  maxDpr: 1,
  scale: 1,
  opacity: 1,
  clickTimeScale: 1,
  trailTimeScale: 1,
})

// --- persistence -----------------------------------------------------------

function loadStored(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

function storeValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be unavailable (private mode / disabled) — state stays
    // session-only and the UI still works.
  }
}

// --- configuration window --------------------------------------------------

const PANEL_STYLE_ID = 'dsh-ba-fx-style'

// Theme-aware via DSH `--dsw-alias-*` tokens (light/dark), with hardcoded
// fallbacks for hosts that do not load the theme token stylesheet.
const PANEL_CSS = `
#dsh-ba-fx-toggle{position:fixed;z-index:2147483000;width:46px;height:46px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.18));background:var(--dsw-alias-bg-layer-2,rgba(15,20,30,.9));color:var(--dsw-alias-label-primary,#fff);font-size:22px;line-height:1;cursor:grab;box-shadow:0 4px 18px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;user-select:none;transition:background .15s}
#dsh-ba-fx-toggle:active{cursor:grabbing}
#dsh-ba-fx-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.12))}
#dsh-ba-fx-panel{position:fixed;z-index:2147483000;width:280px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,rgba(15,20,30,.95));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.16));border-radius:12px;padding:14px 16px 12px;box-shadow:0 10px 34px rgba(0,0,0,.5);color:var(--dsw-alias-label-primary,#e8ebf2);font:12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:none}
#dsh-ba-fx-panel.open{display:block}
#dsh-ba-fx-panel h4{margin:0 0 10px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#fff)}
#dsh-ba-fx-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
#dsh-ba-fx-row label{flex:0 0 auto;color:var(--dsw-alias-label-secondary,#c9cedb)}
#dsh-ba-fx-row .ctrl{flex:1 1 auto;display:flex;align-items:center;justify-content:flex-end;gap:8px}
#dsh-ba-fx-row input[type=range]{width:100%}
#dsh-ba-fx-row input[type=color]{width:44px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.2));border-radius:5px;background:none;cursor:pointer}
#dsh-ba-fx-row input[type=checkbox]{width:auto}
#dsh-ba-fx-row output{min-width:30px;text-align:right;color:var(--dsw-alias-label-secondary,#aab3c4);font-variant-numeric:tabular-nums}
#dsh-ba-fx-actions{display:flex;justify-content:space-between;gap:8px;margin-top:10px}
#dsh-ba-fx-actions button{flex:1;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.18));background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e8ebf2);border-radius:7px;padding:6px 8px;font:inherit;cursor:pointer}
#dsh-ba-fx-actions button:hover{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14))}
`

// --- i18n -------------------------------------------------------------------
// DSH keeps the active locale on <html lang> (e.g. "zh-CN" / "en"). Detect it
// from the document and re-apply the window strings when it changes.
const I18N = {
  zh: {
    title: 'ba-click-fx 特效配置',
    toggleTitle: '配置 ba-click-fx（右键拖动可移动位置）',
    aria: 'ba-click-fx 配置',
    themeColor: '主题颜色',
    scale: '全局缩放',
    opacity: '不透明度',
    clickEnabled: '点击特效',
    trailEnabled: '光标拖尾',
    trailAlways: '拖尾始终显示',
    maxDpr: '最大 DPR',
    clickTimeScale: '点击速度',
    trailTimeScale: '拖尾速度',
    glow: '光晕',
    reset: '恢复默认',
    close: '关闭',
  },
  en: {
    title: 'ba-click-fx Effect Settings',
    toggleTitle: 'Configure ba-click-fx (right-drag to move)',
    aria: 'ba-click-fx configuration',
    themeColor: 'Theme color',
    scale: 'Scale',
    opacity: 'Opacity',
    clickEnabled: 'Click effect',
    trailEnabled: 'Cursor trail',
    trailAlways: 'Trail always',
    maxDpr: 'Max DPR',
    clickTimeScale: 'Click speed',
    trailTimeScale: 'Trail speed',
    glow: 'Glow',
    reset: 'Reset',
    close: 'Close',
  },
}

function detectLang() {
  const docLang = typeof document !== 'undefined' ? (document.documentElement.lang || '') : ''
  const navLang = typeof navigator !== 'undefined' ? (navigator.language || '') : ''
  const tag = (docLang || navLang || 'en').toLowerCase()
  return tag.startsWith('zh') ? 'zh' : 'en'
}

// One row per configurable field: key, label-key, control kind and bounds.
const CONTROL_DEFS = [
  { key: 'themeColor', labelKey: 'themeColor', type: 'color' },
  { key: 'scale', labelKey: 'scale', type: 'range', min: 0.5, max: 3, step: 0.05, format: v => v.toFixed(2) },
  { key: 'opacity', labelKey: 'opacity', type: 'range', min: 0, max: 1, step: 0.01, format: v => v.toFixed(2) },
  { key: 'clickEnabled', labelKey: 'clickEnabled', type: 'checkbox' },
  { key: 'trailEnabled', labelKey: 'trailEnabled', type: 'checkbox' },
  { key: 'trailAlways', labelKey: 'trailAlways', type: 'checkbox' },
  { key: 'maxDpr', labelKey: 'maxDpr', type: 'range', min: 1, max: 2, step: 0.1, format: v => v.toFixed(1) },
  { key: 'clickTimeScale', labelKey: 'clickTimeScale', type: 'range', min: 0.5, max: 2, step: 0.05, format: v => v.toFixed(2) },
  { key: 'trailTimeScale', labelKey: 'trailTimeScale', type: 'range', min: 0.5, max: 2, step: 0.05, format: v => v.toFixed(2) },
  // Glow (bloom) after clicking. Shared multiplier that scales both the click
  // and trail bloom; an Fx param, not a constructor key.
  { key: 'glowIntensity', labelKey: 'glow', type: 'range', min: 0, max: 4, step: 0.05, format: v => v.toFixed(2), default: 1, glow: true },
]

// The subset of defaults the panel can edit (reset must only touch these keys).
const PANEL_DEFAULTS = Object.fromEntries(
  CONTROL_DEFS.map(def => [def.key, def.default ?? DEFAULT_CONFIG[def.key]]),
)

// Panel keys that are Fx params (set via fx.setFxParam) and must NOT be passed
// to the BAClickFX constructor.
const FX_PARAM_KEYS = new Set(
  CONTROL_DEFS.filter(def => def.fxParam || def.glow).map(def => def.key),
)

// Unity's baseline trail bloom emission strength; the shared glow slider scales
// both click and trail bloom from this baseline.
const TRAIL_EMISSION_BASE = 23.968628

/** Apply the shared glow multiplier to both click and trail bloom. */
function applyGlow(fx, value) {
  fx.setFxParam('bloom.clickEmissionScale', value)
  fx.setFxParam('bloom.trailEmission', TRAIL_EMISSION_BASE * value)
}

const bafxClamp = (value, min, max) => Math.min(max, Math.max(min, value))
const BTN_SIZE = 46
const PANEL_W = 280
const PANEL_H = 300

/** Build the draggable gear toggle + configuration panel. Returns { destroy }. */
function createConfigPanel(fx, initial = PANEL_DEFAULTS, uiState) {
  // Own style sheet (tagged so the client module system's HMR bookkeeping
  // recognizes it).
  if (document.getElementById(PANEL_STYLE_ID) === null) {
    const style = document.createElement('style')
    style.id = PANEL_STYLE_ID
    style.dataset.plugin = 'dsh-ba-click-fx'
    style.dataset.pluginCss = PANEL_STYLE_ID
    style.textContent = PANEL_CSS
    document.head.appendChild(style)
  }

  const viewportW = () => window.innerWidth
  const viewportH = () => window.innerHeight

  const toggle = document.createElement('button')
  toggle.id = 'dsh-ba-fx-toggle'
  toggle.type = 'button'
  toggle.textContent = '⚙'

  const panel = document.createElement('div')
  panel.id = 'dsh-ba-fx-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'ba-click-fx 配置')

  const title = document.createElement('h4')
  title.textContent = 'ba-click-fx 特效配置'
  panel.appendChild(title)

  const inputs = new Map()
  const labelEls = new Map()
  for (const def of CONTROL_DEFS) {
    const row = document.createElement('div')
    row.id = 'dsh-ba-fx-row'
    const label = document.createElement('label')
    label.textContent = def.labelKey
    label.htmlFor = `dsh-ba-fx-${def.key}`
    const ctrl = document.createElement('span')
    ctrl.className = 'ctrl'

    let input
    if (def.type === 'checkbox') {
      input = document.createElement('input')
      input.type = 'checkbox'
      input.id = `dsh-ba-fx-${def.key}`
      ctrl.appendChild(input)
    } else {
      input = document.createElement('input')
      input.type = def.type
      input.id = `dsh-ba-fx-${def.key}`
      if (def.type === 'range') {
        input.min = String(def.min)
        input.max = String(def.max)
        input.step = String(def.step)
        const out = document.createElement('output')
        out.htmlFor = input.id
        ctrl.appendChild(input)
        ctrl.appendChild(out)
        inputs.set(`${def.key}:out`, out)
      } else {
        ctrl.appendChild(input)
      }
    }
    row.appendChild(label)
    row.appendChild(ctrl)
    panel.appendChild(row)
    inputs.set(def.key, input)
    labelEls.set(def.key, label)
  }

  // Reset / close actions.
  const actions = document.createElement('div')
  actions.id = 'dsh-ba-fx-actions'
  const resetBtn = document.createElement('button')
  resetBtn.type = 'button'
  resetBtn.textContent = '恢复默认'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.textContent = '关闭'
  actions.appendChild(resetBtn)
  actions.appendChild(closeBtn)
  panel.appendChild(actions)

  document.body.appendChild(toggle)
  document.body.appendChild(panel)

  // --- i18n: detect the DSH locale and re-apply strings on change ----------
  let lang = detectLang()
  const applyStrings = (value) => {
    const dict = I18N[value] || I18N.en
    title.textContent = dict.title
    toggle.title = dict.toggleTitle
    panel.setAttribute('aria-label', dict.aria)
    for (const def of CONTROL_DEFS) {
      const label = labelEls.get(def.key)
      if (label) label.textContent = dict[def.labelKey]
    }
    resetBtn.textContent = dict.reset
    closeBtn.textContent = dict.close
  }
  applyStrings(lang)
  const localeObserver = new MutationObserver(() => {
    const next = detectLang()
    if (next !== lang) {
      lang = next
      applyStrings(next)
    }
  })
  localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })

  // --- position (drag-to-move) ---------------------------------------------
  const clampPos = (left, top) => ({
    left: bafxClamp(left, 8, Math.max(8, viewportW() - BTN_SIZE - 8)),
    top: bafxClamp(top, 8, Math.max(8, viewportH() - BTN_SIZE - 8)),
  })
  let pos = (uiState && Number.isFinite(uiState.left) && Number.isFinite(uiState.top))
    ? clampPos(uiState.left, uiState.top)
    : clampPos(viewportW() - BTN_SIZE - 20, viewportH() - BTN_SIZE - 20)

  const applyButtonPos = () => {
    toggle.style.left = `${pos.left}px`
    toggle.style.top = `${pos.top}px`
  }
  applyButtonPos()

  // --- position: right-button drag-to-move, left-button toggles the panel ---
  let drag = null
  let suppressClick = false
  toggle.addEventListener('contextmenu', (event) => event.preventDefault())

  const onPointerDown = (event) => {
    // Only the right button (button === 2) starts a drag. The left button keeps
    // its normal behaviour and toggles the panel via the `click` event below.
    if (event.button !== 2) return
    event.preventDefault()
    drag = {
      startX: event.clientX, startY: event.clientY,
      startLeft: pos.left, startTop: pos.top,
      moved: false,
    }
    try { toggle.setPointerCapture(event.pointerId) } catch { /* older browsers */ }
  }
  const onPointerMove = (event) => {
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
    if (!drag.moved) return
    pos = clampPos(drag.startLeft + dx, drag.startTop + dy)
    applyButtonPos()
  }
  const onPointerEnd = (event) => {
    if (!drag) return
    const moved = drag.moved
    drag = null
    try { toggle.releasePointerCapture(event.pointerId) } catch { /* older browsers */ }
    if (moved) {
      // A right-button drag that actually moved: persist the new position and
      // ignore any click the browser may still synthesize.
      suppressClick = true
      storeValue(UI_STORAGE_KEY, { left: pos.left, top: pos.top })
      setTimeout(() => { suppressClick = false }, 0)
    }
  }
  toggle.addEventListener('pointerdown', onPointerDown)
  toggle.addEventListener('pointermove', onPointerMove)
  toggle.addEventListener('pointerup', onPointerEnd)
  toggle.addEventListener('pointercancel', onPointerEnd)

  const positionPanel = () => {
    const rect = toggle.getBoundingClientRect()
    let left = rect.left
    if (left + PANEL_W > viewportW() - 12) left = viewportW() - PANEL_W - 12
    let top = rect.top - PANEL_H - 10
    if (top < 12) top = rect.bottom + 10
    if (top + PANEL_H > viewportH() - 12) top = viewportH() - PANEL_H - 12
    panel.style.left = `${Math.max(12, left)}px`
    panel.style.top = `${Math.max(12, top)}px`
  }

  const onResize = () => {
    pos = clampPos(pos.left, pos.top)
    applyButtonPos()
    if (panel.classList.contains('open')) positionPanel()
  }
  window.addEventListener('resize', onResize)

  // Left-click toggles the panel (the right button is reserved for dragging).
  const onClick = () => {
    if (suppressClick) return
    panel.classList.toggle('open')
    if (panel.classList.contains('open')) positionPanel()
  }
  toggle.addEventListener('click', onClick)

  // --- config controls -----------------------------------------------------
  const readControls = () => {
    const value = {}
    for (const def of CONTROL_DEFS) {
      const input = inputs.get(def.key)
      if (def.type === 'checkbox') value[def.key] = input.checked
      else if (def.type === 'color') value[def.key] = input.value
      else value[def.key] = Number(input.value)
    }
    return value
  }

  const applyToFx = (value) => {
    for (const def of CONTROL_DEFS) {
      if (!(def.key in value)) continue
      const v = value[def.key]
      if (def.key === 'themeColor') fx.setThemeColor(v)
      else if (def.glow) applyGlow(fx, v)
      else if (def.fxParam) fx.setFxParam(def.fxParam, v)
      else fx.updateConfig({ [def.key]: v })
    }
  }

  const syncControls = (value) => {
    for (const def of CONTROL_DEFS) {
      const input = inputs.get(def.key)
      const raw = value[def.key]
      const fallback = def.default ?? DEFAULT_CONFIG[def.key]
      if (def.type === 'checkbox') input.checked = raw === true
      else input.value = String(raw ?? fallback)
      const out = inputs.get(`${def.key}:out`)
      if (out && def.format) out.value = def.format(Number(input.value))
      else if (out) out.value = input.value
    }
  }

  const handleChange = () => {
    const next = readControls()
    applyToFx(next)
    storeValue(STORAGE_KEY, next)
    for (const def of CONTROL_DEFS) {
      const out = inputs.get(`${def.key}:out`)
      if (out && def.format) out.value = def.format(next[def.key])
    }
  }

  for (const def of CONTROL_DEFS) {
    inputs.get(def.key).addEventListener('input', handleChange)
    inputs.get(def.key).addEventListener('change', handleChange)
  }

  closeBtn.addEventListener('click', () => panel.classList.remove('open'))
  resetBtn.addEventListener('click', () => {
    syncControls(PANEL_DEFAULTS)
    applyToFx(PANEL_DEFAULTS)
    storeValue(STORAGE_KEY, PANEL_DEFAULTS)
  })

  // Seed the controls with the initial (actually applied) config so the panel
  // reflects reality rather than the static defaults.
  syncControls(initial)

  return {
    destroy() {
      localeObserver.disconnect()
      window.removeEventListener('resize', onResize)
      toggle.remove()
      panel.remove()
      const style = document.getElementById(PANEL_STYLE_ID)
      if (style) style.remove()
    },
  }
}

/**
 * Browser plugin body: mount the full-screen Blue Archive click effect and
 * cursor trail, expose a draggable, theme-aware configuration window, and tear
 * everything down when the plugin is unloaded.
 * @param ctx - client cordis context.
 * @param config - optional per-deployment overrides (spread over the defaults).
 */
function apply(ctx, config = {}) {
  // The client tree can be booted outside a browser (node e2e); there is no
  // DOM to attach an overlay canvas to, so mount nothing.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }
  const saved = loadStored(STORAGE_KEY)
  const merged = { ...DEFAULT_CONFIG, ...PANEL_DEFAULTS, ...saved, ...config }
  // Fx-param keys (glow) are not BAClickFX constructor options.
  const constructorOptions = Object.fromEntries(
    Object.entries(merged).filter(([key]) => !FX_PARAM_KEYS.has(key)),
  )
  const fx = new BAClickFX(constructorOptions)
  // Apply any persisted Fx params that the panel owns.
  for (const def of CONTROL_DEFS) {
    if (def.glow && merged[def.key] !== undefined) {
      applyGlow(fx, merged[def.key])
    } else if (def.fxParam && merged[def.key] !== undefined) {
      fx.setFxParam(def.fxParam, merged[def.key])
    }
  }
  const ui = loadStored(UI_STORAGE_KEY)
  const panel = createConfigPanel(fx, merged, ui)
  ctx.effect(
    () => () => { fx.destroy(); panel.destroy() },
    'dsh-ba-click-fx: click effect lifecycle',
  )
}

// A client bundle that has no cross-plugin value imports needs no `inject`.
// The module table seed provides nothing this body `require()`s.
Object.assign(exports, { name: 'ba-click-fx', apply })

		return module.exports;
	}
});

//# sourceMappingURL=client.js.map