/* ============================================================
   highlight.js — 경량 C++/HLSL 구문 강조기 (외부 의존성 없음)
   <pre><code class="language-cpp"> / language-hlsl / language-bash
   블록을 토큰화하여 span.tok-* 로 감싼다.
   토큰 스캔 방식이라 문자열/주석 안의 키워드를 오인하지 않는다.
   ============================================================ */
(function () {
  "use strict";

  const KEYWORDS = new Set([
    // C++
    "alignas","alignof","and","asm","auto","break","case","catch","class","const",
    "constexpr","const_cast","continue","decltype","default","delete","do","dynamic_cast",
    "else","enum","explicit","export","extern","false","for","friend","goto","if","inline",
    "mutable","namespace","new","noexcept","nullptr","operator","or","override","private",
    "protected","public","register","reinterpret_cast","return","sizeof","static",
    "static_cast","struct","switch","template","this","throw","true","try","typedef",
    "typename","union","using","virtual","volatile","while","not","final",
    // HLSL
    "cbuffer","tbuffer","register","packoffset","in","out","inout","uniform","linear",
    "centroid","nointerpolation","noperspective","sample","precise","groupshared",
    "discard","numthreads","row_major","column_major","technique","pass","SamplerState",
    "SamplerComparisonState","RWStructuredBuffer","StructuredBuffer","ByteAddressBuffer",
    "RWByteAddressBuffer","RWTexture2D","RWBuffer","ConstantBuffer","snorm","unorm",
  ]);

  const TYPES = new Set([
    // C/C++
    "void","bool","char","short","int","long","float","double","unsigned","signed",
    "wchar_t","size_t","int8_t","uint8_t","int16_t","uint16_t","int32_t","uint32_t",
    "int64_t","uint64_t","string","vector","array","map",
    // Win32 / D3D11 타입
    "HRESULT","HWND","HINSTANCE","LRESULT","WPARAM","LPARAM","UINT","DWORD","BOOL","LPCWSTR",
    "ID3D11Device","ID3D11DeviceContext","IDXGISwapChain","ID3D11Buffer","ID3D11InputLayout",
    "ID3D11VertexShader","ID3D11PixelShader","ID3D11ComputeShader","ID3D11GeometryShader",
    "ID3D11RenderTargetView","ID3D11DepthStencilView","ID3D11ShaderResourceView",
    "ID3D11UnorderedAccessView","ID3D11Texture2D","ID3D11SamplerState","ID3D11BlendState",
    "ID3D11RasterizerState","ID3D11DepthStencilState","ID3DBlob","ComPtr","D3D11_VIEWPORT",
    // HLSL 타입
    "float2","float3","float4","float2x2","float3x3","float4x4","int2","int3","int4",
    "uint2","uint3","uint4","bool2","bool3","bool4","double2","double3","double4","half",
    "matrix","Texture2D","Texture3D","TextureCube","Texture2DArray","Texture2DMS",
    // DirectXMath 타입
    "XMFLOAT2","XMFLOAT3","XMFLOAT4","XMFLOAT4X4","XMVECTOR","XMMATRIX","FXMVECTOR","CXMMATRIX",
  ]);

  // D3D/DXGI/DirectXMath 함수는 접두사로 별도 색
  function classifyIdent(word, prev) {
    if (KEYWORDS.has(word)) return "tok-key";
    if (TYPES.has(word)) return "tok-type";
    // D3D11* / DXGI* / XM* / D3DCompile 등 내장 느낌
    if (/^(D3D|DXGI|XM|CreateDXGI|D3D11_|DXGI_|D3D_)/.test(word)) return "tok-bi";
    return null;
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // 마스터 토큰 정규식: 주석 | 문자열 | 전처리기 | 숫자 | 식별자 | 기타
  const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(^[ \t]*#[^\n]*$)|(\b\d[\d.eExXa-fA-F]*[fFuUlL]*\b)|([A-Za-z_]\w*)|([\s\S])/gm;

  function highlight(code) {
    let out = "";
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(code)) !== null) {
      if (m[1] !== undefined) {                 // 주석
        out += '<span class="tok-com">' + esc(m[1]) + "</span>";
      } else if (m[2] !== undefined) {          // 문자열/문자
        out += '<span class="tok-str">' + esc(m[2]) + "</span>";
      } else if (m[3] !== undefined) {          // 전처리기 라인
        // 전처리기 라인 안의 <...>/문자열도 문자열색으로 살짝
        out += '<span class="tok-pre">' + esc(m[3]) + "</span>";
      } else if (m[4] !== undefined) {          // 숫자
        out += '<span class="tok-num">' + esc(m[4]) + "</span>";
      } else if (m[5] !== undefined) {          // 식별자
        const cls = classifyIdent(m[5]);
        // 함수 호출: 뒤에 '(' 가 붙으면 함수색 (내장 아닌 경우)
        let extra = cls;
        if (!extra) {
          const rest = code.slice(TOKEN.lastIndex);
          if (/^\s*\(/.test(rest)) extra = "tok-fn";
        }
        out += extra ? '<span class="' + extra + '">' + esc(m[5]) + "</span>" : esc(m[5]);
      } else {                                   // 기타 문자
        out += esc(m[6]);
      }
    }
    return out;
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("pre > code").forEach(function (el) {
      const cls = el.className || "";
      if (!/language-(cpp|c|hlsl|bash|sh|hlsl-ps|hlsl-vs)/.test(cls)) return;
      // 이미 강조됨 방지
      if (el.dataset.hl) return;
      el.dataset.hl = "1";
      const raw = el.textContent;
      if (/language-(bash|sh)/.test(cls)) {
        // 셸: 주석/문자열만 가볍게
        el.innerHTML = esc(raw)
          .replace(/(#[^\n]*)/g, '<span class="tok-com">$1</span>');
        return;
      }
      el.innerHTML = highlight(raw);
    });
  });
})();
