// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure banner view-model for the in-app update download (#504): given the
// latest `UpdateDownloadStatus` (or null, meaning "just offered") and the
// `UpdateInfo` the banner is showing, decides what text/buttons/progress bar
// to render. Kept DOM-free and IPC-free in a standalone classic script (like
// upgrade-momentum.js) so it's unit-testable yet shared verbatim with the
// renderer, which loads it via <script src> and reads it off
// window.updateDownloadState.

(function (root) {
  'use strict';

  var BYTES_PER_MB = 1024 * 1024;

  /**
   * @param {number} n  Byte count.
   * @returns {string}  e.g. "12.3 MB".
   */
  function formatBytes(n) {
    return (n / BYTES_PER_MB).toFixed(1) + ' MB';
  }

  /**
   * The update-banner view-model for the current download status.
   * @param {{state:string,receivedBytes?:number,totalBytes?:number,percent?:number,message?:string}|null} status
   * @param {{version:string}} info
   * @returns {{text:string, primary:{label:string,action:string}|null, showCancel:boolean, showProgress:boolean, percent:number, indeterminate:boolean}}
   */
  function viewFor(status, info) {
    var v = info.version;

    if (status == null || status.state === 'cancelled') {
      return {
        text: 'Sound Buddy ' + v + ' is available.',
        primary: { label: 'Download', action: 'download' },
        showCancel: false,
        showProgress: false,
        percent: 0,
        indeterminate: false,
      };
    }

    if (status.state === 'downloading') {
      var totalBytes = status.totalBytes;
      var receivedBytes = status.receivedBytes;
      var percent = status.percent;
      var text =
        'Downloading Sound Buddy ' +
        v +
        '… ' +
        (totalBytes > 0
          ? percent + '% (' + formatBytes(receivedBytes) + ' of ' + formatBytes(totalBytes) + ')'
          : formatBytes(receivedBytes));
      return {
        text: text,
        primary: null,
        showCancel: true,
        showProgress: true,
        percent: percent,
        indeterminate: totalBytes === 0,
      };
    }

    if (status.state === 'verifying') {
      return {
        text: 'Verifying download…',
        primary: null,
        showCancel: false,
        showProgress: true,
        percent: 100,
        indeterminate: false,
      };
    }

    if (status.state === 'done') {
      return {
        text: 'Sound Buddy ' + v + ' downloaded and verified.',
        primary: { label: 'Show in Finder', action: 'reveal' },
        showCancel: false,
        showProgress: false,
        percent: 0,
        indeterminate: false,
      };
    }

    // 'error'
    return {
      text: status.message,
      primary: { label: 'Retry', action: 'retry' },
      showCancel: false,
      showProgress: false,
      percent: 0,
      indeterminate: false,
    };
  }

  var api = {
    BYTES_PER_MB: BYTES_PER_MB,
    formatBytes: formatBytes,
    viewFor: viewFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.updateDownloadState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
