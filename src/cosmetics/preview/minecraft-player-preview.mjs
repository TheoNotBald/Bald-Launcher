'use strict';

class MinecraftPlayerPreview {
  constructor(canvas) {
    if (!window.skinview3d?.SkinViewer) throw new Error('Minecraft skin renderer is unavailable.');
    this.canvas = canvas;
    this.viewer = new window.skinview3d.SkinViewer({ canvas, width: 280, height: 300 });
    this.viewer.background = 0x07090b;
    this.viewer.fov = 50;
    this.viewer.zoom = 1.05;
    this.viewer.autoRotate = false;
    if (window.skinview3d.WalkingAnimation) {
      this.viewer.animation = new window.skinview3d.WalkingAnimation();
      this.viewer.animation.speed = 0.7;
    }
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth || 280);
    const height = Math.max(1, this.canvas.clientHeight || 300);
    this.viewer.width = width;
    this.viewer.height = height;
  }

  async setAppearance(skin, cape) {
    if (!skin?.filePath) return false;
    const skinSource = await window.launcherAPI.readCosmeticTexture(skin.filePath);
    if (!skinSource?.ok) throw new Error(skinSource?.error || 'Skin texture unavailable.');
    await this.viewer.loadSkin(skinSource.dataUrl, { model: model === 'slim' ? 'slim' : 'default', makeVisible: true });
    this.viewer.playerObject.visible = true;
    this.viewer.playerObject.skin.visible = true;
    this.viewer.playerWrapper.visible = true;
    if (cape?.filePath) {
      const capeSource = await window.launcherAPI.readCosmeticTexture(cape.filePath);
      if (capeSource?.ok) await this.viewer.loadCape(capeSource.dataUrl);
      else this.viewer.loadCape(null);
    } else {
      this.viewer.loadCape(null);
    }
    this.viewer.render();
    return true;
  }

  async setStudioDataUrl(dataUrl, model, kind) {
    if (kind === 'cape') {
      await this.viewer.loadCape(dataUrl);
      return true;
    }
    await this.viewer.loadSkin(dataUrl, { model: model === 'slim' ? 'slim' : 'default', makeVisible: true });
    this.viewer.playerObject.visible = true;
    this.viewer.playerObject.skin.visible = true;
    this.viewer.playerWrapper.visible = true;
    this.viewer.render();
    return true;
  }

  resetCamera() {
    this.viewer.zoom = 1.05;
    if (this.viewer.playerObject) this.viewer.playerObject.rotation.y = -0.35;
  }

  setVisible(value) {
    this.viewer.paused = !value;
    this.canvas.style.visibility = value ? 'visible' : 'hidden';
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.viewer.dispose();
  }
}

window.MinecraftPlayerPreview = MinecraftPlayerPreview;
window.minecraftPreviewReady = true;
