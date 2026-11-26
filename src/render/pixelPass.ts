import {
  Camera,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';

/** Extra texels rendered on each side so the sub-pixel offset never samples outside. */
const MARGIN = 1;

/**
 * Renders the scene into a small render target, then draws it to the canvas
 * with nearest-neighbour upscaling at an integer factor (the zoom).
 */
export class PixelPass {
  readonly target: WebGLRenderTarget;
  /** Visible render-target size in texels (without the margin). */
  readonly size = new Vector2(1, 1);
  zoom = 3;

  private readonly quadScene = new Scene();
  private readonly quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;

  constructor(private readonly renderer: WebGLRenderer) {
    this.target = new WebGLRenderTarget(1, 1, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
    });
    this.material = new ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        uRtSize: { value: new Vector2(1, 1) },
        uZoom: { value: 3 },
        uOffset: { value: new Vector2(0, 0) },
      },
      vertexShader: /* glsl */ `
        void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 uRtSize;
        uniform float uZoom;
        uniform vec2 uOffset;
        void main() {
          vec2 p = gl_FragCoord.xy / uZoom + ${MARGIN.toFixed(1)} + uOffset;
          gl_FragColor = texture2D(tScene, p / uRtSize);
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new Mesh(new PlaneGeometry(2, 2), this.material));
  }

  /** Fit the canvas to the viewport (CSS px) at the given integer zoom. */
  resize(cssWidth: number, cssHeight: number, dpr: number, zoom: number): void {
    this.zoom = Math.max(1, Math.round(zoom));
    const w = Math.ceil((cssWidth * dpr) / this.zoom);
    const h = Math.ceil((cssHeight * dpr) / this.zoom);
    this.size.set(w, h);
    this.target.setSize(w + 2 * MARGIN, h + 2 * MARGIN);

    const canvas = this.renderer.domElement;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w * this.zoom, h * this.zoom, false);
    canvas.style.width = `${(w * this.zoom) / dpr}px`;
    canvas.style.height = `${(h * this.zoom) / dpr}px`;

    this.material.uniforms.uRtSize.value.set(w + 2 * MARGIN, h + 2 * MARGIN);
    this.material.uniforms.uZoom.value = this.zoom;
  }

  /** Render target texels including the margin; size the camera frustum with these. */
  get renderSize(): Vector2 {
    return new Vector2(this.size.x + 2 * MARGIN, this.size.y + 2 * MARGIN);
  }

  render(scene: Scene, camera: Camera, offsetPx: { x: number; y: number }): void {
    this.material.uniforms.uOffset.value.set(offsetPx.x, offsetPx.y);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}
