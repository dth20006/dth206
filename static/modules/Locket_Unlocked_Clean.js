// Shared module control: enabled=false bypasses every rewrite in this script.
(function () {
    var diagnosticsEnabled = false;
    if (typeof $argument !== "undefined") {
        var control = typeof $argument === "string" ? /^enabled=(true|false)(?:&diagnostics=(true|false))?$/i.exec($argument.trim()) : null;
        if (!control || control[1].toLowerCase() === "false") {
            if (typeof console !== "undefined" && typeof console.log === "function") {
                console.log("[Locket v12] bypass: " + (control ? "enabled=false" : "invalid module argument"));
            }
            $done({});
            return;
        }
        diagnosticsEnabled = !!control[2] && control[2].toLowerCase() === "true";
    }
    // Author: Nguyen Tien Thuong
    // true = apply this group's overrides; false = preserve Locket's config.
    // These switches only control this Remote Config script, not the other scripts.
    var LOCKET_OPTIONS = {
        captions: true, // Caption list, styles and caption feature flags.
        camera: true,   // Camera, gallery, filters, Live Photos and upload quality.
        audio: true,    // Sound/microphone flags; upstream audio-session flag is preserved.
        widget: true,   // Widget flags, frames and widget rewind event.
        network: true, // CDN, buckets, caches and fetch behavior.
        social: true,  // Friends, chat, reactions, streaks and memories.
        appearance: true, // Icons, profile, journal, notifications and Live Activities.
        other: true    // Remaining overrides: ads, telemetry, onboarding and support.
    };

    function rewriteLocketConfig() {
        function logStatus(message) {
            if (typeof console !== "undefined" && typeof console.log === "function") {
                console.log("[Locket RC v12] " + message);
            }
            // Notifications are opt-in and only describe this project's fetch.
            // Never include request URLs, headers, upstream values or captions.
            if (!diagnosticsEnabled || !target.test($request.url || "")) return;
            try {
                if (typeof $notification === "undefined" || typeof $notification.post !== "function") return;
                var outcome = message.indexOf("response rewritten:") === 0 ? "rewritten" : "skipped";
                var key = "locket.rc.diagnostics.response." + outcome;
                var now = Date.now();
                var store = typeof $persistentStore !== "undefined" ? $persistentStore : null;
                if (store && typeof store.read === "function") {
                    var last = Number(store.read(key));
                    if (last > 0 && now >= last && now - last < 60000) return;
                }
                $notification.post("Locket RC - chẩn đoán", "Response: " + outcome, message);
                if (store && typeof store.write === "function") store.write(String(now), key);
            } catch (e) {
                // Diagnostic API/storage failures must not block the rewrite.
            }
        }

        function describeResponseShape(value) {
            // Only allowlisted labels and counts: never echo upstream values,
            // parameter names, URLs, headers, error messages or response bodies.
            var has = Object.prototype.hasOwnProperty;
            var states = ["UPDATE", "NO_CHANGE", "EMPTY_CONFIG", "NO_TEMPLATE"];
            var state = !has.call(value, "state") ? "missing" : states.indexOf(value.state) >= 0 ? value.state : "other";
            var entries = !has.call(value, "entries") ? "missing" : value.entries === null ? "null" : Array.isArray(value.entries) ? "array" : typeof value.entries;
            if (entries === "object") entries += "(" + Object.keys(value.entries).length + ")";
            var rawStatus = $response.status;
            var status = "unknown";
            if (typeof rawStatus === "number" && rawStatus >= 100 && rawStatus <= 599 && Math.floor(rawStatus) === rawStatus) {
                status = String(rawStatus);
            } else if (typeof rawStatus === "string") {
                var match = /^(?:HTTP\/\d(?:\.\d)?\s+)?([1-5]\d\d)(?:\s|$)/.exec(rawStatus);
                if (match) status = match[1];
            }
            return "state=" + state + "; entries=" + entries + "; http=" + status + "; diagnostic=v12-diag2";
        }

        // Scope by project and fetch endpoint, not by the app/SDK User-Agent.
        var target = /^https:\/\/firebaseremoteconfig\.googleapis\.com\/v1\/projects\/locket-4252a\/namespaces\/firebase:fetch(?:\?|$)/;
        if (!target.test($request.url || "")) {
            logStatus("skipped: request URL outside configured project");
            return {};
        }

        var obj;
        try {
            obj = JSON.parse($response.body);
        } catch (e) {
            logStatus("skipped: response is not JSON");
            return {};
        }
        if (!obj || typeof obj !== "object" || Array.isArray(obj) || obj.error) {
            logStatus("skipped: invalid response or upstream error");
            return {};
        }
        // NO_CHANGE has no complete config. Turning it into UPDATE could discard
        // unrelated settings from the app's cache. Leave it intact and report it.
        if (obj.state !== "UPDATE" || !obj.entries || typeof obj.entries !== "object" || Array.isArray(obj.entries)) {
            logStatus("skipped: full UPDATE with entries required; " + describeResponseShape(obj));
            return {};
        }
        var activeGroups = Object.keys(LOCKET_OPTIONS).filter(function (group) {
            return LOCKET_OPTIONS[group] === true;
        });
        if (!activeGroups.length) {
            logStatus("skipped: all groups disabled");
            return {};
        }

        function groupForKey(key) {
            if (/^(video_sound_enabled|microphone_enabled|camera_microphone_enabled)$/.test(key)) return "audio";
            if (/^(camera(?:_|$)|live_photos$|zoom_enabled$|upload_|capture_classification_config$)/.test(key)) return "camera";
            if (/caption|^overlay/.test(key)) return "captions";
            if (/^widget_|^android_widget_/.test(key)) return "widget";
            if (/^cdn_|^storage_bucket|cache|^use_doc_dir_for_image_cache$|^timestamp_based_history_fetches$|^get_latest_moment|^fetch_|^refresh_interval$|^firestore_refresh|^keychain_access_retries$/.test(key)) return "network";
            if (/friend|celebrity|moment_views|moment_reactions|chat|conversation|typing|unsend|reply|messages|^groups|^group_|contacts|^rollcall|^calendar|^time_travel|yearbook|birthday|^memory_|^share_history|^streak|^catch_up/.test(key)) return "social";
            if (/^paywall_presentation_config$|^app_icon|^profile_|^custom_profile_pics$|^lunar_|^journal_|^activity_bar_|^live_activity|^register_live_activity|^notification_|^prompt_notification|^qr_code_/.test(key)) return "appearance";
            return "other";
        }

        // These two JSON objects contain features belonging to several groups.
        var featureGroups = {
            camera_roll: "camera", camera_theme: "camera", longer_video: "camera", video: "camera",
            long_captions: "captions", custom_widget_frames: "widget",
            app_icon_picker: "appearance", profile_badge: "appearance",
            locket_views: "social", unlimited_friends: "social", streak_recovery: "social"
        };
        function applyFeatureOverrides(key, encoded) {
            var overrides = JSON.parse(encoded);
            var keys = Object.keys(overrides);
            var enabled = keys.filter(function (name) {
                return LOCKET_OPTIONS[featureGroups[name] || "other"] === true;
            });
            if (!enabled.length) return;
            if (enabled.length === keys.length) {
                obj.entries[key] = encoded;
                return;
            }
            var original = {};
            if (Object.prototype.hasOwnProperty.call(obj.entries, key)) {
                try {
                    original = JSON.parse(obj.entries[key]);
                    if (!original || typeof original !== "object" || Array.isArray(original)) return;
                } catch (e) {
                    // Cannot safely preserve disabled features in an opaque value.
                    return;
                }
            }
            enabled.forEach(function (name) { original[name] = overrides[name]; });
            obj.entries[key] = JSON.stringify(original);
        }
        function applyOverrides(values) {
            Object.keys(values).forEach(function (key) {
                if (key === "feature_gates" || key === "upsell_features") {
                    applyFeatureOverrides(key, values[key]);
                } else if (LOCKET_OPTIONS[groupForKey(key)] === true) {
                    obj.entries[key] = values[key];
                }
            });
        }

        obj.Attention = "Chúc mừng bạn! Vui lòng không sử dụng chúng dưới mục đích thương mại!";

        applyOverrides({
            feature_gates: JSON.stringify({
                app_icon_picker: "enabled",
                camera_roll: "enabled",
                camera_theme: "enabled",
                locket_views: "enabled",
                long_captions: "enabled",
                longer_video: "enabled",
                unlimited_friends: "enabled",
                priority_support: "enabled",
                profile_badge: "enabled",
                remove_ads: "enabled",
                video: "enabled",
                custom_widget_frames: "enabled",
                streak_recovery: "enabled"
            }),
            upsell_features: JSON.stringify({
                app_icon_picker: true,
                camera_roll: true,
                camera_theme: true,
                locket_views: true,
                remove_ads: true,
                custom_widget_frames: true
            }),
            paywall_presentation_config: JSON.stringify({
                uid: "paywall_testflight",
                onboarding: false,
                after_sent_moment: false,
                on_foreground: false,
                interval: 2592000,
                profile_banner: false
            }),
            android_subscribe_gold_button_enabled: "false",
            profile_badge_visible: "true",
            lunar_new_year_app_icon_enabled: "true"
        });

        applyOverrides({
            history_ads_mode: "off",
            history_ads_prefetch_count: "0",
            history_ads_prefetch_immediate: "false",
            history_ads_prefetch_reroute: "false",
            history_ads_dynamic_insertion: "false",
            history_ads_refresh_prefetch_on_foreground: "false",
            history_ads_floor_price: "0",
            history_ads_floor_price_att: "0",
            history_ad_log_displayed_on_background: "false",
            history_ads_debug_menu: "false",
            sentry_sample_rate: "0",
            sentry_network_tracing: "false",
            sentry_performance_tracking: "false",
            sentry_trace_sample_rate: "0",
            sentry_profiles_sample_rate: "0"
        });

        applyOverrides({
            camera: JSON.stringify({
                gold_max_duration: 15.0,
                goldMaxDuration: 15.0,
                max_duration: 15.0,
                maxDuration: 15.0,
                ultra_wide: true,
                ultraWide: true,
                volume_button: true,
                volumeButton: true,
                flash_button: true,
                telephoto: true,
                srgb: true,
                lanczos: true,
                quality_mbps: 0.6,
                qualityMbps: 0.6
            }),
            camera_roll: JSON.stringify({
                gold_max_duration: 0.0,
                goldMaxDuration: 0.0,
                video_max_duration: 0.0,
                videoMaxDuration: 0.0,
                max_duration: 0.0,
                maxDuration: 0.0,
                trim_max_duration: 0.0,
                trimMaxDuration: 0.0,
                camera_roll_max_duration: 0.0,
                quality_mbps: 0.6,
                qualityMbps: 0.6,
                flash_button: true
            }),
            live_photos: JSON.stringify({
                capture: true,
                video: true,
                viewing: true,
                catch_up: true,
                widget_looping_mode: "never"
            }),
            camera_filter_config: JSON.stringify({
                allows_custom_filters: false,
                show_filter_button: false,
                sheet_enabled: false,
                open_sheet_immediately: false,
                sheet_filters: [],
                picker_filters: []
            }),
            camera_roll_preview_enabled: "true",
            camera_roll_video_enabled: "false",
            camera_roll_video_upload_enabled: "false",
            internal_camera_roll_video_upload_enabled: "false",
            longer_camera_roll_videos_enabled: "false",
            video_sound_enabled: "true",
            microphone_enabled: "true",
            camera_microphone_enabled: "true",
            // Audio experiment: preserve the upstream audio-session setting.
            // The effect of this flag on received video audio is unverified.
            zoom_enabled: "true",
            upload_main: "false",
            upload_main_image_quality: "0.6",
            upload_main_image_size: "1440",
            upload_thumbnail_image_quality: "0.8",
            upload_thumbnail_image_size: "1020"
        });

        applyOverrides({
            max_friends_count: "999999999",
            friend_limit_mode: "0",
            soft_friend_limit_threshold_count: "999999999",
            show_friend_limit_on_cam: "false",
            signup_max_friends_count: "999999999",
            celebrity_inbox_limit: "999999999",
            celebrity_inbox_enabled: "true",
            celebrity_vip_qr_redemption_enabled: "true",
            friend_limit_geo_override: JSON.stringify({ experiments: {}, area_code_overrides: {} }),
            friends_sheet_locket_count_config: JSON.stringify({ items: [{ threshold: 0, icon_name: "heart" }, { threshold: 1, icon_name: "heart.fill" }, { threshold: 10, emoji: "🤍" }, { threshold: 100, emoji: "💛" }, { threshold: 500, emoji: "❤️‍🔥" }, { threshold: 1000, emoji: "🌟🫶🌟" }, { threshold: 2000, emoji: "✨💟✨" }, { threshold: 5000, emoji: "⚡️😵‍💫⚡" }, { threshold: 10000, emoji: "✨⚡️😱⚡✨" }] }),
            friend_locket_count_config: JSON.stringify({ items: [{ threshold: 0, icon_name: "heart" }, { threshold: 1, icon_name: "heart.fill" }, { threshold: 10, emoji: "🤍" }, { threshold: 100, emoji: "💛" }, { threshold: 500, emoji: "❤️‍🔥" }, { threshold: 1000, emoji: "✨💗✨" }, { threshold: 2000, emoji: "✨️⭐️✨" }, { threshold: 5000, emoji: "✨💎✨" }, { threshold: 10000, emoji: "✨🔐💛✨" }] }),
            new_friends_monitoring_enabled: "true",
            improved_friend_suggestions: "true",
            show_friend_suggestions_by_default: "true",
            emoji_friend_suggestions: "true",
            prompt_contact_permissions_on_search: "true",
            populate_phone_numbers_from_suggest_friends: "true",
            hide_friends_enabled: "true",
            hide_invite_links: "false",
            hide_skip_contacts: "true",
            show_all_contacts: "true",
            show_invite_suggestions: "true",
            show_no_friends_bottom_sheet: "false",
            signup_allow_skip_add_friends: "true",
            signup_custom_profile_picture: "true",
            user_data_export_enabled: "true",
            username_suggestions_enabled: "true",
        });

        try {
            if (LOCKET_OPTIONS.social === true) {
                var streak = JSON.parse(obj.entries.streak_config || "{}");
                streak.minimum_recovery_count = 0;
                streak.minimum_display_count = 0;
                obj.entries.streak_config = JSON.stringify(streak);
            }
        } catch (e) { }

        applyOverrides({
            moment_views_enabled: "true",
            moment_views_v2: "true",
            record_moment_views: "true",
            notify_moment_views: "true",
            get_moment_views_as_cloud_function: "true",
            moment_reactions_v2: "true",
            chat_reactions_enabled: "true",
            conversation_reactions: "true",
            typing_indicators_enabled: "true",
            unsend_message_enabled: "true",
            reply_prototype_enabled: "true",
            messages_integration: "true",
            conversations_enabled: "true",
            fetch_moments_in_conversation: "true",
            hide_chat_button: "false",
            groups_enabled: "true",
            groups_feature_mode: "enabled",
            camera_filter: "false",
            camera_filters_enabled: "false",
            camera_filter_enabled: "false",
            camera_filter_sheet_enabled: "false",
            group_contact_invites_enabled: "true",
            groups_onboarding_accept_invite_preview_enabled: "true",
            chat_hyperlink_enabled_mode: "always_enabled",
            send_to_self_only_mode: "always_enabled",
            time_travel_rewind_v2_enabled: "true",
            conversation_drafts_enabled: "true",
            calendar_delete_moment_enabled: "true",
            calendar_rewind_enabled: "true",
            locket_yearbook_story_sharing_encouraged: "true",
            rollcall_enabled: "true",
            rollcall_comment_actions: "true",
            rollcall_profile_button: "true",
            rollcall_prompt_export_after_share: "true",
            rollcall_confirm_skip_tagging: "true",
            rollcall_profile_memories_enabled: "true",
            rollcall_tap_to_tag_enabled: "true",

            debug_section_in_profile_menu: "true",
            private_mode: "true",
            private_mode_enabled: "true",
            enable_private_mode: "true",
            is_private_mode_enabled: "true",
            viewer_mode: "true",
            viewer_mode_enabled: "true",
            enable_viewer_mode: "true",
            close_friends: "true",
            close_friends_enabled: "true",
            enable_close_friends: "true",
            parent_center: "true",
            poll_caption: "true",
            poll_caption_enabled: "true",
            review_caption_enabled: "true",
            breaking_news_caption_enabled: "true",
            weather_caption_enabled: "true",
            join_community_enabled: "true",
            community_requirements: JSON.stringify({ photos_sent: 0, friends_added: 0 }),
            group_scrapbook_config: JSON.stringify({ enabled: true, locked_state_enabled: false, moment_limit: 99 }),
            birthday_feature_config: JSON.stringify({ profile_menu: true, prompt_interval: 1209600, show_frame: true }),
            profile_friends_button: JSON.stringify({ enabled: true }),
            capture_classification_config: JSON.stringify({ detection: true, debug_caption: false, expanded_sheet_legacy_support: true, display_reaction_suggestions: true }),
            rollcall_comment_replies: "true",
            rollcall_live_activity_enabled: "true",
            rollcall_history_dedup_enabled: "true",
            rollcall_banner_treatment: "image_stack",
            rollcall_invite_link_preview_style: "spread",
            rollcall_share_templates: JSON.stringify({ templates: ["bold", "pop_off", "stacking", "full_screen", "shadow_box", "collage", "pop_collage"], random_order: true }),
            rollcall_tag_friend_sheet_config: JSON.stringify({ enabled: true, suggestion_mode: "none" }),
            rollcall_live_activity_config: JSON.stringify({ empty_previews_by_default: true }),
            rollcall_banner_config: JSON.stringify({ display_mode: "active", start_at: "2020-01-01T00:00:00Z", end_at: "2099-12-31T23:59:59Z", recurring_schedule: null }),
            rollcall_badge_refresh_config: JSON.stringify({ ttl: { sunday: 0, monday: 7200, tuesday: 7200, wednesday: 7200, thursday: 7200, friday: 7200, saturday: 7200 }, disabled_days: [] }),
        });

        applyOverrides({
            widget_frame_event_max_images: "5",
            android_widget_frame_event_enabled: "true",
            widget_badge_enabled: "true",
            widget_badge_v2: "true",
            widget_stale_state_enabled: "false",
            widget_last_sent_indicator: "false",
            widget_sync_token_reload_mode: "clearTokenNever",
            widget_frame_event: JSON.stringify({
                uid: "midautumn_2026",
                url: "https://i.ibb.co/1Yt1Dzzy/Shin-chan-1.png",
                use_local_time_zone: true,
                placement: "below",
                start_at: "2020-01-01T00:00:00",
                end_at: "2099-12-31T23:59:59"
            }),
            live_activity_onboarding: "true",
            live_activity_onboarding_variant: "friending",
            register_live_activity_push_to_start_token: "true",
            live_activity_remove_stale_start_token: "true",
            notification_preferences_live_activities: "true",
            notification_preferences: "true",
            notification_reply_body_visible: "true",
            prompt_notification_permissions_after_friending: "true",
            activity_bar_enabled: "true",
            journal_activity_bar_enabled: "true",
            journal_settings: JSON.stringify({
                debug_menu_enabled: true,
                focus_animation: false,
                compact_header: true,
                friends_button: false,
                reverse_scroll_direction: false,
                streak_visualization: true,
                streak_visualization_style: "gradient",
                streak_header_minimum_count: 0,
                streak_visualization_minimum_count: 2,
                overlay_indicators: { location: false, music: true, static_content: true, weather: true }
            }),
            qr_code_config: JSON.stringify({ profile_enabled: true, scanning_enabled: true }),
            custom_profile_pics: "true",
            profile_menu_v2_enabled: "true"
        });

        applyOverrides({
            cdn_domain_replacements: JSON.stringify({ "firebasestorage.googleapis.com": "cdn.locketcamera.com" }),
            cdn_domain_replacements_video: "true",
            storage_bucket: "gs://locket-img",
            storage_bucket_video: "gs://locket-video",
            image_cache_max_age_sec: "157680000",
            image_cache_max_size: "400000000",
            history_cache_age_days: "1000",
            user_cache_max_age_sec: "691200",
            friends_cache_max_age_sec: "2592000",
            image_fetch_cache: "true",
            image_cache_use_shared: "true",
            use_doc_dir_for_image_cache: "true",
            efficient_history_cache_invalidation: "true",
            timestamp_based_history_fetches: "true",
            get_latest_moment_v2: "true",
            fetch_users_from_cloud_function: "true",
            refresh_interval: "60",
            firestore_refresh_v2: "true",
            firestore_refresh_v3: "true",
            keychain_access_retries: "true",
            blocked_users_cached_sync_enabled: "true",
            beta_features_enabled: "true",
            join_testflight_enabled: "true",
            safety_center: "true",
            help_center: "true",
            support_v2: "true",
            privacy_choices_setting: "true",
            request_att_permission: "true",
            invite_link_preview_variant: "4",
            share_history_config: JSON.stringify({ prompt_enabled: false, fetching_enabled: true }),
            share_history_prompt_enabled: "false",
            use_thumbnails_for_sharing: "true",
            use_thumbnails_in_timeline: "true",
            persist_onboarding_step: "true",
            onboarding_contact_permission_step: "true",
        });

        applyOverrides({
            overlay_navigator_enabled: "true",
            overlays_v2_config: JSON.stringify({ suggestions_enabled: true }),
            captions_enabled: "true",
            music_caption_enabled: "true",
            music_caption_song_preview_enabled: "true",
            link_caption_link_enabled: "true",
            overlay_dynamic_captions: JSON.stringify([
                "standard", "poll", "color_palette", "review", "music", "location",
                "weather", "time", "streak", "star_sign", "party_time", "locket_count",
                "good_morning", "goodnight", "ootd", "miss_you", "custom", "halloween_2026"
            ]),
            overlay_items: JSON.stringify([
                {
                    section: "🎨 General",
                    items: [
                        { overlay_id: "caption:standard", source: "local", caption: { type: "standard" } },
                        { overlay_id: "caption:link", source: "local", caption: { type: "link" } },
                        { overlay_id: "caption:review", source: "local", caption: { type: "review" } },
                        { overlay_id: "caption:poll", source: "local", caption: { type: "poll" } },
                        { overlay_id: "caption:music", source: "local", caption: { type: "music" } },
                        { overlay_id: "caption:location", source: "local", caption: { type: "location" } },
                        { overlay_id: "caption:weather", source: "local", caption: { type: "weather" } },
                        { overlay_id: "caption:time", source: "local", caption: { type: "time" } },
                        { overlay_id: "caption:streak", source: "local", caption: { type: "streak" } },
                        { overlay_id: "caption:star_sign", source: "local", caption: { type: "star_sign" } },
                        { overlay_id: "caption:color_palette", source: "local", caption: { type: "color_palette" } },
                        { overlay_id: "caption:quote", source: "local", caption: { type: "quote" } },
                        { overlay_id: "caption:breaking_news", source: "local", caption: { type: "breaking_news" } },
                        { overlay_id: "caption:locket_count", source: "local", caption: { type: "locket_count" } },
                    ]
                },

                {
                    section: "🎨 Holiday Caption",
                    items: [
                        { overlay_id: "caption:halloween_2026", source: "remote", caption: { background: { colors: ["#150804", "#C8540D"] }, icon: { type: "image", data: "https://storage.googleapis.com/locket-public/journal_calendar_assets/holiday_indicators/halloween_indicator%403x.png", source: "url" }, max_lines: 1, text: "Halloween", localized_text: { en: "Halloween", vn: "Halloween" }, text_color: "#FFB182", type: "static_content" } },
                        { overlay_id: "caption:autumn_2026", source: "remote", caption: { background: { colors: ["#FFE0A0", "#F6A53A"] }, icon: { data: "🍂", type: "emoji" }, max_lines: 1, text: "Xin chào Mùa Thu", localized_text: { en: "Xin chào Mùa Thu", vn: "Xin chào Mùa Thu" }, text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:christmas_eve_2026", source: "remote", caption: { background: { colors: ["#2FA85F", "#176B3A"] }, icon: { data: "🕯️", type: "emoji" }, max_lines: 1, text: "Giáng sinh an lành", localized_text: { en: "Giáng sinh an lành", vn: "Giáng sinh an lành" }, text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:christmas_day_2026", source: "remote", caption: { background: { colors: ["#E53935", "#A81818"] }, icon: { data: "🎄", type: "emoji" }, max_lines: 1, text: "Giáng sinh an lành", localized_text: { en: "Giáng sinh an lành", vn: "Giáng sinh an lành" }, text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:new_years_eve_2026", source: "remote", caption: { background: { colors: ["#FFC64B", "#FFEDBF"] }, icon: { data: "🥂", type: "emoji" }, max_lines: 1, text: "Xin chào 2027!", localized_text: { en: "Xin chào 2027!", vn: "Xin chào 2027!" }, text_color: "#643F00", type: "static_content" } },
                        { overlay_id: "caption:new_years_day_2027", source: "remote", caption: { background: { colors: ["#3B00EC", "#823FFF"] }, icon: { data: "💫", type: "emoji" }, max_lines: 1, text: "Xin chào 2027!", localized_text: { en: "Xin chào 2027!", vn: "Xin chào 2027!" }, text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:new_years_day_2027_alternate", source: "remote", caption: { background: { colors: ["#FF0062", "#FF783F"] }, max_lines: 1, text: "2027", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:no_memory", source: "remote", caption: { background: { image: { type: "image", data: "https://public.locketcamera.com/locket-public/overlays/forgotten_island/forgotten_island_bg.png", source: "url" }, colors: ["#1A1A2E", "#16213E"] }, max_lines: 1, text: "NO MEMORY LEFT BEHIND", text_color: "#FFFFFFE6", type: "static_content" } },
                    ]
                },
                {
                    section: "🎨 Decorative by Locket",
                    items: [
                        { overlay_id: "caption:toi_nho_em", source: "remote", caption: { background: { colors: ["#FFFFFF", "#6D9EEB"] }, max_lines: 1, text: "보고 싶어 🥺", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:party_time", source: "remote", caption: { background: { colors: ["#5EFFF5", "#FCFF57"] }, icon: { data: "🪩", type: "emoji" }, max_lines: 1, text: "Party Time!", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:good_morning", source: "remote", daily_start_hour: 5, daily_end_hour: 10, caption: { background: { colors: ["#EF7402", "#EABF0F"] }, icon: { data: "☀️", type: "emoji" }, max_lines: 1, text: "Good morning", text_color: "#FFFFFFE5", type: "static_content" } },
                        { overlay_id: "caption:goodnight", source: "remote", daily_start_hour: 19.5, daily_end_hour: 24, caption: { background: { colors: ["#370C6F", "#575CD4"] }, icon: { data: "🌙", type: "emoji" }, max_lines: 1, text: "Goodnight", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:miss_you", source: "remote", caption: { background: { colors: ["#EC0C00", "#FF493F"] }, icon: { data: "🥰", type: "emoji" }, max_lines: 1, text: "Miss you", text_color: "#FFFFFFDB", type: "static_content" } },
                        { overlay_id: "caption:ootd", source: "remote", caption: { background: { colors: ["#FFFFFF", "#DBDBDB"] }, icon: { data: "🕶", type: "emoji" }, max_lines: 1, text: "OOTD", text_color: "#101010E6", type: "static_content" } },
                    ]
                },

                {
                    section: "🎨 Tình yêu & Cơm chó 💕",
                    items: [
                        { overlay_id: "caption:thuong_men_tram_lam_truc_ly", source: "remote", caption: { background: { colors: ["#FCE7F3", "#FBCFE8"] }, icon: { data: "🌷", type: "emoji" }, max_lines: 1, text: "Trầm Lâm Trúc Ly", text_color: "#831843", type: "static_content" } },
                        { overlay_id: "caption:thuong_men_nguyen_hoang_hao", source: "remote", caption: { background: { colors: ["#DBEAFE", "#BFDBFE"] }, icon: { data: "💙", type: "emoji" }, max_lines: 1, text: "Nguyễn Hoàng Hảo", text_color: "#1E3A8A", type: "static_content" } },
                        { overlay_id: "caption:thuong_men_nguyen_tien_thuong", source: "remote", caption: { background: { colors: ["#EDE9FE", "#DDD6FE"] }, icon: { data: "✨", type: "emoji" }, max_lines: 1, text: "Nguyễn Tiến Thương", text_color: "#4C1D95", type: "static_content" } },
                        { overlay_id: "caption:thuong_men_ngoan_xinh_yeu", source: "remote", caption: { background: { colors: ["#FFE4E6", "#FECDD3"] }, icon: { data: "🎀", type: "emoji" }, max_lines: 1, text: "Ngoan xinh yêu của anh", text_color: "#881337", type: "static_content" } },
                        { overlay_id: "caption:thuong_men_thich_an_mam", source: "remote", caption: { background: { colors: ["#FEF3C7", "#FDE68A"] }, icon: { data: "🍚", type: "emoji" }, max_lines: 1, text: "Thích ăn Mắm", text_color: "#78350F", type: "static_content" } },
                        { overlay_id: "caption:thuong_men_yeu_oiiii", source: "remote", caption: { background: { colors: ["#FAE8FF", "#F5D0FE"] }, icon: { data: "💗", type: "emoji" }, max_lines: 1, text: "yêu oiiii", text_color: "#701A75", type: "static_content" } },

                        { overlay_id: "caption:em_nho_anhh", source: "remote", caption: { background: { colors: ["#FF6B81", "#FF8E9E", "#FFB3C6"] }, icon: { data: "🥺", type: "emoji" }, max_lines: 1, text: "em nhớ anhh", text_color: "#8C1938", type: "static_content" } },
                        { overlay_id: "caption:nho_anh_phien", source: "remote", caption: { background: { colors: ["#F0B5CB", "#F6D0DF", "#DCCAF0"] }, icon: { data: "🥺", type: "emoji" }, max_lines: 1, text: "nhớ anh tới mức hơi phiền", text_color: "#70445A", type: "static_content" } },
                        { overlay_id: "caption:i_love_you", source: "remote", caption: { background: { colors: ["#FF8FAB", "#FFC2D1", "#FFE5EC"] }, icon: { data: "💗", type: "emoji" }, max_lines: 1, text: "i love you", text_color: "#8A304F", type: "static_content" } },
                        { overlay_id: "caption:yeu_cuc_dang", source: "remote", caption: { background: { colors: ["#F2B5C8", "#F8D5D9", "#F6E5D2"] }, icon: { data: "🎀", type: "emoji" }, max_lines: 1, text: "yêu cục dàng", text_color: "#754454", type: "static_content" } },
                        { overlay_id: "caption:yeu_emmm", source: "remote", caption: { background: { colors: ["#F2AFC6", "#F7C9D9", "#E5CFF4"] }, icon: { data: "💗", type: "emoji" }, max_lines: 1, text: "Yeu Emmm", text_color: "#70445C", type: "static_content" } },
                        { overlay_id: "caption:yeu_anhhh", source: "remote", caption: { background: { colors: ["#B8C9F2", "#D5DDF8", "#E8CFF0"] }, icon: { data: "🫶", type: "emoji" }, max_lines: 1, text: "Yeu Anhhh", text_color: "#414C72", type: "static_content" } },
                        { overlay_id: "caption:baby_love", source: "remote", caption: { background: { colors: ["#FFB6C1", "#FF69B4", "#FF1493"] }, icon: { data: "🧸", type: "emoji" }, max_lines: 1, text: "Baby Love 💖", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:muon_duoc_om", source: "remote", caption: { background: { colors: ["#FF9A9E", "#FECFEF"] }, icon: { data: "🫂", type: "emoji" }, max_lines: 1, text: "Muốn được ôm", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:cho_hun_mieng", source: "remote", caption: { background: { colors: ["#F3AFC7", "#F8D0D8", "#F4C9BB"] }, icon: { data: "😘", type: "emoji" }, max_lines: 1, text: "cho hun miếng coi", text_color: "#754252", type: "static_content" } },
                        { overlay_id: "caption:me_anh_me_ngu", source: "remote", caption: { background: { colors: ["#C4C8EF", "#DED3F4", "#EBCDE4"] }, icon: { data: "💤", type: "emoji" }, max_lines: 1, text: "mê anh hơn mê ngủ", text_color: "#4F4770", type: "static_content" } },
                        { overlay_id: "caption:be_be_can_do", source: "remote", caption: { background: { colors: ["#FF8FAB", "#FFC2D1", "#FFE5EC"] }, icon: { data: "🎀", type: "emoji" }, max_lines: 1, text: "em bé cần được dỗ", text_color: "#812D4A", type: "static_content" } },
                        { overlay_id: "caption:iu_thi_noi", source: "remote", caption: { background: { colors: ["#FFD166", "#FFE8A3", "#FFF3D0"] }, icon: { data: "🤭", type: "emoji" }, max_lines: 1, text: "iu thì nói, đừng có ngại", text_color: "#704510", type: "static_content" } },
                        { overlay_id: "caption:iu_hong_thi_bao", source: "remote", caption: { background: { colors: ["#FF6B6B", "#FF9999", "#FFD1C9"] }, icon: { data: "🎀", type: "emoji" }, max_lines: 1, text: "iu hong thì bảo", text_color: "#812626", type: "static_content" } },
                        { overlay_id: "caption:anh_thuong_em", source: "remote", caption: { background: { colors: ["#A0C4FF", "#BDE0FE", "#DFF3FF"] }, icon: { data: "🥹", type: "emoji" }, max_lines: 1, text: "anh có thương em thiệt hong", text_color: "#23466F", type: "static_content" } },
                        { overlay_id: "caption:yeu_em_nhiem_vu", source: "remote", caption: { background: { colors: ["#B7E4C7", "#D8F3DC", "#F0FFF1"] }, icon: { data: "🫡", type: "emoji" }, max_lines: 1, text: "yêu em là nhiệm vụ cả đời", text_color: "#24563A", type: "static_content" } },
                        { overlay_id: "caption:crush_nhin", source: "remote", caption: { background: { colors: ["#CDB4DB", "#E2CFEA", "#F3E5F5"] }, icon: { data: "🫠", type: "emoji" }, max_lines: 1, text: "crush nhìn em một cái là xong", text_color: "#593B68", type: "static_content" } },
                        { overlay_id: "caption:ngoai_le_cua_em", source: "remote", caption: { background: { colors: ["#80CBC4", "#B2DFDB", "#E0F2F1"] }, icon: { data: "🫶", type: "emoji" }, max_lines: 1, text: "anh là ngoại lệ của em", text_color: "#205953", type: "static_content" } },
                        { overlay_id: "caption:dang_ban_tuong_tu", source: "remote", caption: { background: { colors: ["#1A2980", "#26D0CE"] }, icon: { data: "💭", type: "emoji" }, max_lines: 1, text: "Đang bận tương tư", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:mac_bay_tinh_yeu", source: "remote", caption: { background: { colors: ["#EE9CA7", "#FFDDE1"] }, icon: { data: "💘", type: "emoji" }, max_lines: 1, text: "Mắc bẫy tình yêu", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:minh_cuoi_nhau", source: "remote", caption: { background: { colors: ["#F0B8CD", "#F7D4DF", "#E7C9EF"] }, icon: { data: "💍", type: "emoji" }, max_lines: 1, text: "hông ấy mình cưới nhau đi", text_color: "#70465B", type: "static_content" } },
                        { overlay_id: "caption:wedding_time", source: "remote", caption: { background: { colors: ["#FFE4E1", "#E73C7E"] }, icon: { data: "💍", type: "emoji" }, max_lines: 1, text: "Wedding Time!", localized_text: { en: "Wedding Time!", vn: "Đám cưới nè!" }, text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:dating_time", source: "remote", caption: { background: { colors: ["#E91E63", "#F44336"] }, icon: { data: "💕", type: "emoji" }, max_lines: 1, text: "Dating Time!", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:tuong_love_hoa_ra_lop", source: "remote", caption: { background: { colors: ["#C9184A", "#FF4D6D", "#FFB3C6"] }, icon: { data: "❤️‍🩹", type: "emoji" }, max_lines: 1, text: "Tưởng love hoá ra lốp", text_color: "#64152F", type: "static_content" } },
                        { overlay_id: "caption:cam_thay_hanh_phuc", source: "remote", caption: { background: { colors: ["#EC407A", "#F8BBD0"] }, icon: { data: "🇻🇳", type: "emoji" }, max_lines: 1, text: "Cảm thấy hạnh phúc", localized_text: { en: "Feeling Happy", vn: "Cảm thấy hạnh phúc" }, text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:cho_anh_chut_thoi", source: "remote", caption: { background: { colors: ["#F4A6B7", "#F6BFA6", "#F8D9A0"] }, icon: { data: "heart.fill", type: "sf_symbol", color: "#E85D75" }, max_lines: 1, text: "Chờ anh chút thôi", text_color: "#593744", type: "static_content" } },
                    ]
                },
                {
                    section: "🎨 Gen Z & Xéo xắt 💅",
                    items: [
                        { overlay_id: "caption:custom_deadline_duoi", source: "remote", caption: { background: { colors: ["#4C1D95", "#EC4899"] }, icon: { data: "🏃‍♂️", type: "emoji" }, max_lines: 1, text: "Deadline dí, tôi dí lại", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_luong_ve_chua", source: "remote", caption: { background: { colors: ["#D97706", "#FDE68A"] }, icon: { data: "💸", type: "emoji" }, max_lines: 1, text: "Lương chưa về, bill đã tới", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_ngu_5_phut", source: "remote", caption: { background: { colors: ["#312E81", "#818CF8"] }, icon: { data: "😴", type: "emoji" }, max_lines: 1, text: "Ngủ 5 phút, dậy năm sau", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_khong_cau_cau", source: "remote", caption: { background: { colors: ["#7F1D1D", "#F97316"] }, icon: { data: "🌋", type: "emoji" }, max_lines: 1, text: "Không cáu, chỉ hơi bốc khói", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_nhin_gi", source: "remote", caption: { background: { colors: ["#BE185D", "#FDA4AF"] }, icon: { data: "👀", type: "emoji" }, max_lines: 1, text: "Nhìn gì? Thích hả?", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_crush_seen", source: "remote", caption: { background: { colors: ["#1D4ED8", "#93C5FD"] }, icon: { data: "💔", type: "emoji" }, max_lines: 1, text: "Crush seen, tim tôi lag", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_wifi_tinh_yeu", source: "remote", caption: { background: { colors: ["#0F766E", "#5EEAD4"] }, icon: { data: "📶", type: "emoji" }, max_lines: 1, text: "Tình yêu yếu hơn Wi-Fi", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_yeu_la_phai_an", source: "remote", caption: { background: { colors: ["#C2410C", "#FDBA74"] }, icon: { data: "🍜", type: "emoji" }, max_lines: 1, text: "Yêu đương gì, đi ăn đã", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_code_chay_la_duoc", source: "remote", caption: { background: { colors: ["#111827", "#6366F1"] }, icon: { data: "💻", type: "emoji" }, max_lines: 1, text: "Code chạy là được, đừng hỏi", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_bug_la_ban", source: "remote", caption: { background: { colors: ["#166534", "#86EFAC"] }, icon: { data: "🐛", type: "emoji" }, max_lines: 1, text: "Bug là bạn, fix là duyên", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_trai_tim_404", source: "remote", caption: { background: { colors: ["#581C87", "#D8B4FE"] }, icon: { data: "🫠", type: "emoji" }, max_lines: 1, text: "404: Không tìm thấy người yêu", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_dep_khong_can_filter", source: "remote", caption: { background: { colors: ["#9D174D", "#F9A8D4"] }, icon: { data: "🪞", type: "emoji" }, max_lines: 1, text: "Đẹp sẵn, filter thất nghiệp", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_vua_ngu_vua_giau", source: "remote", caption: { background: { colors: ["#14532D", "#FACC15"] }, icon: { data: "🤑", type: "emoji" }, max_lines: 1, text: "Vừa muốn ngủ vừa muốn giàu", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_tinh_yeu_bao_tri", source: "remote", caption: { background: { colors: ["#334155", "#94A3B8"] }, icon: { data: "🛠️", type: "emoji" }, max_lines: 1, text: "Trái tim đang bảo trì", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:custom_hong_on_nhung_on", source: "remote", caption: { background: { colors: ["#BE123C", "#FDA4AF"] }, icon: { data: "🎀", type: "emoji" }, max_lines: 1, text: "Hông ổn nhưng vẫn xinh", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:feeling_cute", source: "remote", caption: { background: { colors: ["#F8BBD0", "#E91E63"] }, icon: { data: "🌷", type: "emoji" }, max_lines: 1, text: "Feeling Cute", localized_text: { en: "Feeling Cute", vn: "Cảm thấy dthw" }, text_color: "#FFFFFFE5", type: "static_content" } },
                        { overlay_id: "caption:cutie_pie", source: "remote", caption: { background: { colors: ["#FFDEE9", "#FFB6C1", "#FF9AA2"] }, icon: { data: "🎀", type: "emoji" }, max_lines: 1, text: "Cutie Pie 🌸", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:hello_kitty", source: "remote", caption: { background: { colors: ["#FFD1DC", "#FFB7C5", "#FFC0CB"] }, icon: { data: "🌸", type: "emoji" }, max_lines: 1, text: "Hello Kitty 🐱", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:ngoan_xinh_iu", source: "remote", caption: { background: { colors: ["#F3C1D4", "#F8DDE5", "#E8CFF0"] }, icon: { data: "💗", type: "emoji" }, max_lines: 1, text: "ngoan xinh iu của ai đây", text_color: "#71465D", type: "static_content" } },
                        { overlay_id: "caption:xinh_dep_tuyet_voi", source: "remote", caption: { background: { colors: ["#FC5C7D", "#6A82FB"] }, icon: { data: "💅", type: "emoji" }, max_lines: 1, text: "Xinh đẹp tuyệt vời", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:hom_nay_slay", source: "remote", caption: { background: { colors: ["#C5B5E8", "#DDD0F2", "#F0C9DD"] }, icon: { type: "sf_symbol", data: "sparkles", color: "#514368" }, max_lines: 1, text: "hôm nay cũng slay", text_color: "#514368", type: "static_content" } },
                        { overlay_id: "caption:tinh_hoa_hoi_tu", source: "remote", caption: { background: { image: { type: "image", data: "star_sign_background", source: "local" }, colors: ["#FFD700", "#FF8C00"] }, icon: { type: "sf_symbol", data: "wand.and.sparkles", color: "#000000E6" }, max_lines: 1, text: "Tinh hoa hội tụ", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:xinh_gai_an_phim_1", source: "remote", caption: { background: { colors: ["#F77062", "#FE5196"] }, icon: { data: "💅", type: "emoji" }, max_lines: 1, text: "Xinh gái ấn phím 1", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:xinh_la_tai_nang", source: "remote", caption: { background: { colors: ["#F0B5CA", "#F5D2DD", "#EAD1F0"] }, icon: { data: "🎀", type: "emoji" }, max_lines: 1, text: "xinh là một loại tài năng", text_color: "#70435B", type: "static_content" } },
                        { overlay_id: "caption:dep_trai_co_gi_sai", source: "remote", caption: { background: { colors: ["#FF5722", "#FFC107"] }, icon: { data: "😎", type: "emoji" }, max_lines: 1, text: "Đẹp trai có gì sai", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:dep_khong_ly_do", source: "remote", caption: { background: { colors: ["#E5B7CD", "#F0D0DC", "#DCCCF0"] }, icon: { data: "🪞", type: "emoji" }, max_lines: 1, text: "đẹp không cần lý do", text_color: "#67455C", type: "static_content" } },
                        { overlay_id: "caption:cha_nay_tu_luyen_ghe", source: "remote", caption: { background: { colors: ["#FFDEE9", "#B5FFFC", "#FAD0C4", "#FFD1FF"] }, icon: { data: "🪞", type: "emoji" }, max_lines: 1, text: "Cha này tự luyến ghê", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:phu_tinh_khong_phu_ban", source: "remote", caption: { background: { colors: ["#8E2DE2", "#4A00E0"] }, icon: { data: "🕶️", type: "emoji" }, max_lines: 1, text: "Phụ tình không phụ bản", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:main_character", source: "remote", caption: { background: { colors: ["#D6B8E8", "#E8CDEB", "#F3D2D9"] }, icon: { type: "sf_symbol", data: "movieclapper.fill", color: "#5A4366" }, max_lines: 1, text: "main character của cuộc đời mình", text_color: "#5A4366", type: "static_content" } },
                        { overlay_id: "caption:vibe_khong_phai_ai", source: "remote", caption: { background: { colors: ["#80D8FF", "#A0F0E0", "#D9FFF5"] }, icon: { data: "🪩", type: "emoji" }, max_lines: 1, text: "vibe này ko phải ai cũng có", text_color: "#174C58", type: "static_content" } },
                        { overlay_id: "caption:khi_chat", source: "remote", caption: { background: { colors: ["#FFB36B", "#FFD49B", "#FFF0C2"] }, icon: { data: "😎", type: "emoji" }, max_lines: 1, text: "không hoàn hảo nhưng có khí chất", text_color: "#713D20", type: "static_content" } },
                        { overlay_id: "caption:sieu_cap_ba_khi", source: "remote", caption: { background: { colors: ["#EC407A", "#F44336"] }, icon: { data: "🐉", type: "emoji" }, max_lines: 1, text: "siêu cấp bá khí", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:ba_khi", source: "remote", caption: { background: { colors: ["#8EACCD", "#B5C8DE", "#D7C7E6"] }, icon: { data: "😎", type: "emoji" }, max_lines: 1, text: "bá khí ngang ngược", text_color: "#35475D", type: "static_content" } },
                        { overlay_id: "caption:du_ba_khi_chua", source: "remote", caption: { background: { colors: ["#CBB4DE", "#DFCBEA", "#F2E3F7"] }, icon: { data: "👑", type: "emoji" }, max_lines: 1, text: "Đủ bá khí chưa?", text_color: "#4C385C", type: "static_content" } },
                        { overlay_id: "caption:oach_xa_lach", source: "remote", caption: { background: { colors: ["#11998E", "#38EF7D"] }, icon: { data: "🥬", type: "emoji" }, max_lines: 1, text: "oách xà lách", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:cung_cung_di", source: "remote", caption: { background: { colors: ["#FF7043", "#FF8A50", "#FFCA70"] }, icon: { data: "🚀", type: "emoji" }, max_lines: 1, text: "Cũng cứng đi", text_color: "#592313", type: "static_content" } },
                        { overlay_id: "caption:ra_duong_ne_moi_anh", source: "remote", caption: { background: { colors: ["#BCC5D6", "#D7DEEA", "#EDE8F5"] }, icon: { data: "🕶️", type: "emoji" }, max_lines: 1, text: "Ra đường nể mỗi anh", text_color: "#384358", type: "static_content" } },
                        { overlay_id: "caption:nhin_la_biet_uy_tin", source: "remote", caption: { background: { colors: ["#2980B9", "#2C3E50"] }, icon: { data: "👌", type: "emoji" }, max_lines: 1, text: "Nhìn là biết uy tín", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:flex_den_hoi_tho_cuoi", source: "remote", caption: { background: { colors: ["#00BFA5", "#64E8C8", "#C4FFF0"] }, icon: { data: "💎", type: "emoji" }, max_lines: 1, text: "Flex đến hơi thở cuối", text_color: "#064D43", type: "static_content" } },
                        { overlay_id: "caption:tui_khong_hon_thua", source: "remote", caption: { background: { colors: ["#8E2430", "#C0394B", "#F08A8E"] }, icon: { data: "😎", type: "emoji" }, max_lines: 1, text: "tui không hơn thua, tui hơn hẳn", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:hon_hom_qua", source: "remote", caption: { background: { colors: ["#B9D7D0", "#D6E6D7", "#E8DFC6"] }, icon: { data: "🫶", type: "emoji" }, max_lines: 1, text: "tui không hơn ai, tui hơn hôm qua", text_color: "#3F554E", type: "static_content" } },
                        { overlay_id: "caption:khong_phai_gu", source: "remote", caption: { background: { colors: ["#FF6F91", "#FF9A9E", "#FFD1BA"] }, icon: { data: "💅", type: "emoji" }, max_lines: 1, text: "không phải gu của tất cả, may quá", text_color: "#70243D", type: "static_content" } },
                        { overlay_id: "caption:quan_trong_lam", source: "remote", caption: { background: { colors: ["#7566D9", "#9B8AFB", "#D2C8FF"] }, icon: { data: "💅", type: "emoji" }, max_lines: 1, text: "ủa tưởng mình quan trọng lắm?", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:cai_net_ky", source: "remote", caption: { background: { colors: ["#B7D96C", "#D9ED9A", "#F1F7C8"] }, icon: { data: "😒", type: "emoji" }, max_lines: 1, text: "cái nết kỳ ghê", text_color: "#35451B", type: "static_content" } },
                        { overlay_id: "caption:ghet_dua_kia_ghe", source: "remote", caption: { background: { colors: ["#52647A", "#7D91A8", "#BBC9D8"] }, icon: { data: "😒", type: "emoji" }, max_lines: 1, text: "ghét đứa kia ghê 😒", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:khong_ghet_khong_ua", source: "remote", caption: { background: { colors: ["#FFAB40", "#FFD180", "#FFF0C2"] }, icon: { data: "😒", type: "emoji" }, max_lines: 1, text: "không ghét, chỉ không ưa", text_color: "#633B12", type: "static_content" } },
                        { overlay_id: "caption:toi_song_the_day", source: "remote", caption: { background: { colors: ["#202124", "#525866", "#AAB2C0"] }, icon: { data: "😎", type: "emoji" }, max_lines: 1, text: "Tôi sống thế đấy", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:che_manh", source: "remote", caption: { background: { colors: ["#FF4E50", "#F9D423"] }, icon: { data: "👎", type: "emoji" }, max_lines: 1, text: "Chê mạnh", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:chua_du_wow", source: "remote", caption: { background: { colors: ["#FFD1DC", "#FFB7C5", "#FFE4E1"] }, icon: { data: "🎀", type: "emoji" }, max_lines: 1, text: "Chưa đủ wow", text_color: "#6E4254", type: "static_content" } },
                        { overlay_id: "caption:roi_let_luon", source: "remote", caption: { background: { colors: ["#FF9A9E", "#FECFEF", "#FBC2EB", "#A6C1EE"] }, icon: { data: "💅", type: "emoji" }, max_lines: 1, text: "rồi lét luôn", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:roi_gay_luon", source: "remote", caption: { background: { colors: ["#FF6EC7", "#7873F5", "#4ADEDE", "#FFE66D"] }, icon: { data: "🌈", type: "emoji" }, max_lines: 1, text: "rồi gay luôn", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:dang_truc_tiep", source: "remote", caption: { background: { colors: ["#0000001A", "#0000001A"], material_blur: "regular" }, icon: { data: "circle.fill", type: "sf_symbol", color: "#FF3B5C" }, max_lines: 1, text: "ĐANG TRỰC TIẾP", text_color: "#FFFFFF", type: "static_content" } },
                    ]
                },
                {
                    section: "🎨 Meme & Hài hước 🤡",
                    items: [
                        { overlay_id: "caption:cuoi_vcl_m_oi", source: "remote", caption: { background: { colors: ["#F7971E", "#FFD200", "#FFEE58"] }, icon: { data: "😂", type: "emoji" }, max_lines: 1, text: "Cười vcl m oi", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:cuoi_xiu", source: "remote", caption: { background: { colors: ["#FFEB3B", "#FF9800"] }, icon: { data: "😎", type: "emoji" }, max_lines: 1, text: "Cười xỉu", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:luon_vui_tuoi", source: "remote", caption: { background: { colors: ["#00F2FE", "#4FACFE"] }, icon: { data: "🤡", type: "emoji" }, max_lines: 1, text: "Luôn vui tươi", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:nau_xoi", source: "remote", caption: { background: { colors: ["#B8E04A", "#D9F477", "#F5FFB8"] }, icon: { data: "🙀", type: "emoji" }, max_lines: 1, text: "Nấu xói", text_color: "#394713", type: "static_content" } },
                        { overlay_id: "caption:con_vien_la_lan", source: "remote", caption: { background: { colors: ["#A8C3A0", "#DCE5D1"] }, icon: { data: "🍂", type: "emoji" }, max_lines: 1, text: "côn viên lá làn", text_color: "#344536", type: "static_content" } },
                        { overlay_id: "caption:gian_dang_iu_hong", source: "remote", caption: { background: { colors: ["#A8E6CF", "#D4F1BE", "#FFF1B6"] }, icon: { data: "🪳", type: "emoji" }, max_lines: 1, text: "Gián đáng iu hong", text_color: "#315847", type: "static_content" } },
                        { overlay_id: "caption:am_cha_hui", source: "remote", caption: { background: { colors: ["#F1C0D2", "#F5D9E1", "#E7D1F2"] }, icon: { data: "🎀", type: "emoji" }, max_lines: 1, text: "ăm chã húi, bà chã hơm", text_color: "#70475C", type: "static_content" } },
                        { overlay_id: "caption:hong_drama", source: "remote", caption: { background: { colors: ["#8A2387", "#E94057", "#F27121"] }, icon: { data: "🍿", type: "emoji" }, max_lines: 1, text: "Hóng drama", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:ke_chuyen_nghe_choi", source: "remote", caption: { background: { colors: ["#8A2387", "#E94057"] }, icon: { data: "🍿", type: "emoji" }, max_lines: 1, text: "Kể chuyện nghe chơi", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:drama_ai_hong", source: "remote", caption: { background: { colors: ["#F0C4A8", "#F3D8B8", "#D8C6E5"] }, icon: { data: "🍿", type: "emoji" }, max_lines: 1, text: "thân ai nấy lo, drama ai nấy hóng", text_color: "#624736", type: "static_content" } },
                        { overlay_id: "caption:check_var", source: "remote", caption: { background: { colors: ["#11998E", "#38EF7D"] }, icon: { data: "📺", type: "emoji" }, max_lines: 1, text: "Check VAR liền", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:co_bien_co_bien", source: "remote", caption: { background: { colors: ["#FF512F", "#F09819", "#FFD200"] }, icon: { type: "sf_symbol", data: "light.beacon.max.fill", color: "#FFFFFFE6" }, max_lines: 1, text: "Có biến có biến", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:so_ho_la_bao", source: "remote", caption: { background: { colors: ["#F5B8A9", "#F6D0B2", "#E8BFCB"] }, icon: { data: "🚨", type: "emoji" }, max_lines: 1, text: "sơ hở là báo", text_color: "#713F40", type: "static_content" } },
                        { overlay_id: "caption:bot_bao", source: "remote", caption: { background: { colors: ["#7AA6C2", "#B0C9D9", "#DCE8EF"] }, icon: { data: "🚨", type: "emoji" }, max_lines: 1, text: "bớt báo giùm cái", text_color: "#29485D", type: "static_content" } },
                        { overlay_id: "caption:ai_so_thi_di_ve", source: "remote", caption: { background: { colors: ["#B71C1C", "#FF5722"] }, icon: { data: "🏃", type: "emoji" }, max_lines: 1, text: "ai sợ thì đi về", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:chay_ngay_di", source: "remote", caption: { background: { colors: ["#D31027", "#EA384D"] }, icon: { data: "🏃💨", type: "emoji" }, max_lines: 1, text: "Chạy ngay đi", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:len_chua_khong_biet_lay_ai", source: "remote", caption: { background: { colors: ["#D7CCC8", "#EFEBE9", "#F5F5F0"] }, icon: { data: "🙏🥺", type: "emoji" }, max_lines: 1, text: "lên chùa không biết lạy ai", text_color: "#5D4037", type: "static_content" } },
                        { overlay_id: "caption:dam_nhau_khong", source: "remote", caption: { background: { colors: ["#E53935", "#FF7043"] }, icon: { data: "🥊", type: "emoji" }, max_lines: 1, text: "đấm nhau không", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:hao_han", source: "remote", caption: { background: { colors: ["#292E49", "#8E3B46", "#E09F3E"] }, icon: { data: "🗡️", type: "emoji" }, max_lines: 1, text: "Hảo hán", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:mong_ton_hoa_sen", source: "remote", caption: { background: { colors: ["#D8B4E2", "#F8BBD0"] }, icon: { data: "🪷", type: "emoji" }, max_lines: 1, text: "Mong tôn hoa sen thấy cảnh này", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:con_cai_nit", source: "remote", caption: { background: { colors: ["#D7CCC8", "#8D6E63"] }, icon: { data: "🧶", type: "emoji" }, max_lines: 1, text: "còn cái nịt", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:minh_la_lop", source: "remote", caption: { background: { colors: ["#263238", "#455A64"] }, icon: { data: "🛞", type: "emoji" }, max_lines: 1, text: "Mình là lốp", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:hay_ra_de_qua_a", source: "remote", caption: { background: { colors: ["#FFF59D", "#80DEEA"] }, icon: { data: "🥺", type: "emoji" }, max_lines: 1, text: "Hay ra dẻ quá à!", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:mac_co_qua_hai_oi", source: "remote", caption: { background: { colors: ["#FFB74D", "#F8BBD0"] }, icon: { data: "😭", type: "emoji" }, max_lines: 1, text: "Mắc cỡ quá hai ơi", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:than_chua_ma_don", source: "remote", caption: { background: { colors: ["#607D8B", "#37474F"] }, icon: { data: "😔", type: "emoji" }, max_lines: 1, text: "Thân chưa mà dỡn", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:ai_muon", source: "remote", caption: { background: { colors: ["#FF6B35", "#FF9F1C", "#FFE0A3"] }, icon: { data: "🤨", type: "emoji" }, max_lines: 1, text: "ủa rồi ai mượn?", text_color: "#6B2814", type: "static_content" } },
                        { overlay_id: "caption:co_ra_dai_khong", source: "remote", caption: { background: { colors: ["#FF4D6D", "#FF8E72", "#FFD6A5"] }, icon: { data: "😭", type: "emoji" }, max_lines: 1, text: "có ra dại không", text_color: "#6B1833", type: "static_content" } },
                        { overlay_id: "caption:he_dieu_hanh_la", source: "remote", caption: { background: { colors: ["#287271", "#57A99A", "#B5E5D5"] }, icon: { data: "🤨", type: "emoji" }, max_lines: 1, text: "bạn mình nhưng hệ điều hành lạ", text_color: "#153F3D", type: "static_content" } },
                        { overlay_id: "caption:ai_cung_khac", source: "remote", caption: { background: { colors: ["#343A40", "#59636E", "#AAB4BE"] }, icon: { data: "🤡", type: "emoji" }, max_lines: 1, text: "ai rồi cũng khác, riêng bạn thì lạ", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:tuong_tuong", source: "remote", caption: { background: { colors: ["#3977D5", "#78A9F5", "#D0E4FF"] }, icon: { data: "🤡", type: "emoji" }, max_lines: 1, text: "tưởng gì, hóa ra tưởng tượng", text_color: "#173767", type: "static_content" } },
                        { overlay_id: "caption:be_hong_sai", source: "remote", caption: { background: { colors: ["#F4A7C3", "#FFD1DC", "#FFF0F3"] }, icon: { data: "😌", type: "emoji" }, max_lines: 1, text: "bé hông có sai, tại đời sai", text_color: "#802D50", type: "static_content" } },
                        { overlay_id: "caption:khong_vua_long", source: "remote", caption: { background: { colors: ["#D5A64B", "#E8C979", "#FFF0BF"] }, icon: { data: "😌", type: "emoji" }, max_lines: 1, text: "sống sao cho vừa lòng thiên hạ? thôi khỏi", text_color: "#594015", type: "static_content" } },
                        { overlay_id: "caption:boc_trung_sit_rit", source: "remote", caption: { background: { colors: ["#9C27B0", "#7B1FA2"] }, icon: { data: "🎁", type: "emoji" }, max_lines: 1, text: "Bóc trúng sít rịt", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:hen_lam_moi_xui_duoc_vay_a", source: "remote", caption: { background: { colors: ["#00BCD4", "#0097A7"] }, icon: { data: "😅", type: "emoji" }, max_lines: 1, text: "Hên lắm mới xui được vậy á", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:giam_suc_manh_con_tuong", source: "remote", caption: { background: { colors: ["#4CAF50", "#00BCD4"] }, icon: { data: "🎮", type: "emoji" }, max_lines: 1, text: "Giảm sức mạnh con tướng", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:phu_huynh_dung_xem", source: "remote", caption: { background: { colors: ["#FF0844", "#FFB199"] }, icon: { data: "🙈", type: "emoji" }, max_lines: 1, text: "Phụ huynh đừng xem", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:khong_van_de_gi_luon", source: "remote", caption: { background: { colors: ["#087E8B", "#39B8A5", "#B8F2E6"] }, icon: { data: "👌", type: "emoji" }, max_lines: 1, text: "Không vấn đề gì luôn", text_color: "#103F43", type: "static_content" } },
                        { overlay_id: "caption:bung_no", source: "remote", caption: { background: { colors: ["#FF6B6B", "#FF8E53", "#FFD166"] }, icon: { data: "💥", type: "emoji" }, max_lines: 1, text: "Bùng nổ", text_color: "#702B16", type: "static_content" } },
                        { overlay_id: "caption:xin_vinh_biet_cu", source: "remote", caption: { background: { colors: ["#232526", "#414345"] }, icon: { data: "🕯️", type: "emoji" }, max_lines: 1, text: "Xin vĩnh biệt cụ", text_color: "#FFFFFFE6", type: "static_content" } }
                    ]
                },
                {
                    section: "🎨 Bất ổn & Hết cứu 🫠",
                    items: [
                        { overlay_id: "caption:bat_on_that_su", source: "remote", caption: { background: { colors: ["#636363", "#A2AB58"] }, icon: { data: "🫠", type: "emoji" }, max_lines: 1, text: "Bất ổn thật sự", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:nay_la_het_cuu", source: "remote", caption: { background: { colors: ["#607D8B", "#455A64"] }, icon: { type: "sf_symbol", data: "bolt.badge.xmark", color: "#FFFFFFE6" }, max_lines: 1, text: "Này là hết cứu", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:het_cuu_thiet", source: "remote", caption: { background: { colors: ["#B8C9E8", "#D5D5F0", "#E9CDE0"] }, icon: { data: "🫠", type: "emoji" }, max_lines: 1, text: "hết cứu thiệt chứ", text_color: "#454660", type: "static_content" } },
                        { overlay_id: "caption:toi_cong_chuyen", source: "remote", caption: { background: { colors: ["#F2B5A7", "#F6D1B5", "#E9C2D5"] }, icon: { data: "💀", type: "emoji" }, max_lines: 1, text: "tới công chuyện nữa rồi", text_color: "#634044", type: "static_content" } },
                        { overlay_id: "caption:toang_that_roi", source: "remote", caption: { background: { colors: ["#F44336", "#B71C1C"] }, icon: { data: "🐉", type: "emoji" }, max_lines: 1, text: "Toang thật rồi", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:toi_roi_toi_roi", source: "remote", caption: { background: { colors: ["#F7253E", "#FF6B35", "#FFC857"] }, icon: { data: "❗", type: "emoji" }, max_lines: 1, text: "Tới rồi tới rồi", text_color: "#58151B", type: "static_content" } },
                        { overlay_id: "caption:goi_xong_lun", source: "remote", caption: { background: { colors: ["#F3B6AF", "#F6D2C2", "#EAC8D9"] }, icon: { data: "😭", type: "emoji" }, max_lines: 1, text: "gòi xong lun á", text_color: "#6A4549", type: "static_content" } },
                        { overlay_id: "caption:xiu_ngang", source: "remote", caption: { background: { colors: ["#C0B7E5", "#D8D0F0", "#EACDE2"] }, icon: { data: "💀", type: "emoji" }, max_lines: 1, text: "xĩu ngang xĩu dọc", text_color: "#504567", type: "static_content" } },
                        { overlay_id: "caption:guc_nga", source: "remote", caption: { background: { colors: ["#3A1C71", "#D76D77"] }, icon: { data: "📉", type: "emoji" }, max_lines: 1, text: "Gục ngã", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:bat_luc", source: "remote", caption: { background: { colors: ["#2C3E50", "#3498DB"] }, icon: { data: "🏳️", type: "emoji" }, max_lines: 1, text: "Bất lực", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:rot_nuoc_mat", source: "remote", caption: { background: { colors: ["#1CB5E0", "#000046"] }, icon: { data: "😭", type: "emoji" }, max_lines: 1, text: "Rớt nước mắt", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:tien_dinh", source: "remote", caption: { background: { colors: ["#FF9A8B", "#FF6A88"] }, icon: { data: "🌪️", type: "emoji" }, max_lines: 1, text: "Tiền đình", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:nao_bao_tri", source: "remote", caption: { background: { colors: ["#B8E0D2", "#D8EAD8", "#C9D9F0"] }, icon: { data: "🧠", type: "emoji" }, max_lines: 1, text: "não đang bảo trì", text_color: "#35564F", type: "static_content" } },
                        { overlay_id: "caption:overthinking_vai_chuong", source: "remote", caption: { background: { colors: ["#2C3E50", "#4CA1AF"] }, icon: { data: "🤯", type: "emoji" }, max_lines: 1, text: "Overthinking vai chưởng", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:tram_cam_nhe", source: "remote", caption: { background: { colors: ["#1F1C2C", "#928DAB"] }, icon: { data: "🫠", type: "emoji" }, max_lines: 1, text: "Trầm cảm nhẹ", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:khong_cam_xuc", source: "remote", caption: { background: { colors: ["#434343", "#000000"] }, icon: { data: "🗿", type: "emoji" }, max_lines: 1, text: "Không cảm xúc", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:mieng_cuoi_long_khong", source: "remote", caption: { background: { colors: ["#526A82", "#8CA6B8", "#D5E3E8"] }, icon: { data: "🙂", type: "emoji" }, max_lines: 1, text: "miệng cười nhưng lòng thì không", text_color: "#233746", type: "static_content" } },
                        { overlay_id: "caption:hom_nay_toi_buon", source: "remote", caption: { background: { colors: ["#141E30", "#243B55"] }, icon: { data: "🥀", type: "emoji" }, max_lines: 1, text: "hôm nay tôi buồn", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:dem_nay_noi_buon", source: "remote", caption: { background: { colors: ["#283B66", "#526C9E", "#A9C1D9"] }, icon: { data: "🌙", type: "emoji" }, max_lines: 1, text: "đêm nay ai ôm nỗi buồn", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:em_on_ap_luc", source: "remote", caption: { background: { colors: ["#FFB26B", "#FFD08A", "#FFF0B5"] }, icon: { data: "🥲", type: "emoji" }, max_lines: 1, text: "em ổn, ổn áp lực", text_color: "#70401F", type: "static_content" } },
                        { overlay_id: "caption:mot_minh", source: "remote", caption: { background: { colors: ["#AEB8D1", "#C7C7DF", "#DED0E0"] }, icon: { data: "🫂", type: "emoji" }, max_lines: 1, text: "thôi thì mình lại một mình", text_color: "#45475F", type: "static_content" } },
                        { overlay_id: "caption:nan_nhan", source: "remote", caption: { background: { colors: ["#F3C7D9", "#F6D9D0", "#E5CFF0"] }, icon: { data: "🥹", type: "emoji" }, max_lines: 1, text: "tui là nạn nhân", text_color: "#70495D", type: "static_content" } },
                        { overlay_id: "caption:ai_cuu_tui", source: "remote", caption: { background: { colors: ["#F0B6B6", "#F5D0C3", "#E8C6DE"] }, icon: { data: "sos", type: "sf_symbol", color: "#6A4248" }, max_lines: 1, text: "òi ai cứu tui", text_color: "#6A4248", type: "static_content" } },
                        { overlay_id: "caption:song_gio_phu_doi_trai", source: "remote", caption: { background: { colors: ["#3A1C71", "#D76D77"] }, icon: { data: "🌪️", type: "emoji" }, max_lines: 1, text: "Sóng gió phủ đời trai", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:thuong_nguoi_khong_thuong", source: "remote", caption: { background: { colors: ["#C8A6C4", "#D9B9D0", "#E7C8D6"] }, icon: { data: "💔", type: "emoji" }, max_lines: 1, text: "thương người không thương mình", text_color: "#5D3F59", type: "static_content" } },
                        { overlay_id: "caption:tu_da_tinh", source: "remote", caption: { background: { colors: ["#52658F", "#9A8FBF", "#F2B6B8"] }, icon: { data: "🫠", type: "emoji" }, max_lines: 1, text: "lại tự mình đa tình", text_color: "#373653", type: "static_content" } },
                        { overlay_id: "caption:khong_du_tot", source: "remote", caption: { background: { colors: ["#AFC6D8", "#C8D5E2", "#E0D1DE"] }, icon: { type: "sf_symbol", data: "cloud.sun.rain.fill", color: "#455467" }, max_lines: 1, text: "chắc tại mình không đủ tốt", text_color: "#455467", type: "static_content" } },
                        { overlay_id: "caption:hy_vong_that_vong", source: "remote", caption: { background: { colors: ["#8E354A", "#C45D69", "#F0B6A8"] }, icon: { data: "🥀", type: "emoji" }, max_lines: 1, text: "một chút hy vọng, một đống thất vọng", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:het_duyen_het_thuong", source: "remote", caption: { background: { colors: ["#334E68", "#627D98", "#BCCCDC"] }, icon: { data: "💭", type: "emoji" }, max_lines: 1, text: "hết duyên hay hết thương?", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:nguoi_vui_nho", source: "remote", caption: { background: { colors: ["#455A64", "#78909C", "#CFD8DC"] }, icon: { data: "🩶", type: "emoji" }, max_lines: 1, text: "người vui có nhớ người buồn không", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:da_xem_chua_rep", source: "remote", caption: { background: { colors: ["#2979FF", "#64B5F6", "#BBDEFB"] }, icon: { data: "📱", type: "emoji" }, max_lines: 1, text: "đã xem, chưa rep, đã đau", text_color: "#15345C", type: "static_content" } },
                        { overlay_id: "caption:dung_im_lang", source: "remote", caption: { background: { colors: ["#FF8FA3", "#FFB3C6", "#FFE0E9"] }, icon: { data: "🥺", type: "emoji" }, max_lines: 1, text: "đừng im lặng với em mà", text_color: "#812D49", type: "static_content" } },
                        { overlay_id: "caption:nho_thi_nho", source: "remote", caption: { background: { colors: ["#E5A642", "#F4CB78", "#FFF0C2"] }, icon: { data: "🙂", type: "emoji" }, max_lines: 1, text: "nhớ thì nhớ, quay lại thì thôi", text_color: "#633F13", type: "static_content" } },
                        { overlay_id: "caption:em_hong_doi", source: "remote", caption: { background: { colors: ["#65A30D", "#A3C957", "#E2F0B0"] }, icon: { data: "🥲", type: "emoji" }, max_lines: 1, text: "em hong có dỗi, em chỉ buồn", text_color: "#2F4712", type: "static_content" } },
                        { overlay_id: "caption:doi_roi", source: "remote", caption: { background: { colors: ["#FF5F6D", "#FFC371"] }, icon: { data: "😤", type: "emoji" }, max_lines: 1, text: "Dỗi rồi", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:dung_choc_be", source: "remote", caption: { background: { colors: ["#F1BDD0", "#F8DCE5", "#E8D1F2"] }, icon: { data: "🥺", type: "emoji" }, max_lines: 1, text: "thui mừ đừng có chọc bé", text_color: "#70475D", type: "static_content" } },
                        { overlay_id: "caption:dung_lam_be_quao", source: "remote", caption: { background: { colors: ["#FF8A5B", "#FFB36B", "#FFE3A3"] }, icon: { data: "😾", type: "emoji" }, max_lines: 1, text: "đừng có làm bé quạo", text_color: "#71351F", type: "static_content" } },
                        { overlay_id: "caption:xin_lui_duoc_chua", source: "remote", caption: { background: { colors: ["#F6D365", "#FDA085"] }, icon: { data: "🥺", type: "emoji" }, max_lines: 1, text: "Xin lũi được chưa", text_color: "#000000", type: "static_content" } },
                        { overlay_id: "caption:biet_roi_kho", source: "remote", caption: { background: { colors: ["#FF7A59", "#FFAD73", "#FFE0A3"] }, icon: { data: "🥲", type: "emoji" }, max_lines: 1, text: "bíc gòi khổ lém", text_color: "#71351F", type: "static_content" } },
                        { overlay_id: "caption:hong_be_oi", source: "remote", caption: { background: { colors: ["#58C9A5", "#A4E6C8", "#E0F7D9"] }, icon: { data: "🥹", type: "emoji" }, max_lines: 1, text: "hong bé ơi", text_color: "#205844", type: "static_content" } },
                        { overlay_id: "caption:khum_biet_nua", source: "remote", caption: { background: { colors: ["#5367C5", "#8F9FE8", "#D5D8FF"] }, icon: { data: "🫠", type: "emoji" }, max_lines: 1, text: "khum có bíc nữa", text_color: "#29346F", type: "static_content" } },
                        { overlay_id: "caption:cai_deo_ma", source: "remote", caption: { background: { colors: ["#FF6B6B", "#FF8E53", "#FFD166"] }, icon: { data: "🤬", type: "emoji" }, max_lines: 1, text: "cái đéo má ??", text_color: "#542323", type: "static_content" } },
                        { overlay_id: "caption:cai_gi_vay_troi", source: "remote", caption: { background: { colors: ["#FF512F", "#FF8C42", "#FFD166"] }, icon: { data: "❗", type: "emoji" }, max_lines: 1, text: "Cái gì vậy trời", text_color: "#672016", type: "static_content" } },
                        { overlay_id: "caption:khong_the_tin_noi", source: "remote", caption: { background: { colors: ["#3867FF", "#725CFF", "#B9A5FF"] }, icon: { data: "❓", type: "emoji" }, max_lines: 1, text: "Không thể tin nổi", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:vl_m_oi", source: "remote", caption: { background: { colors: ["#20212D", "#51566D", "#A8B4C9"] }, icon: { data: "😳", type: "emoji" }, max_lines: 1, text: "vl m ơi?", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:ua_alo", source: "remote", caption: { background: { colors: ["#FFB347", "#FFD166", "#FFF0A8"] }, icon: { data: "questionmark", type: "sf_symbol", color: "#654018" }, max_lines: 1, text: "Ủa alo", text_color: "#654018", type: "static_content" } },
                        { overlay_id: "caption:alo_gi_da", source: "remote", caption: { background: { colors: ["#00A896", "#55CDB5", "#B8F0D8"] }, icon: { data: "😭", type: "emoji" }, max_lines: 1, text: "Ủa alo, gì dạ?", text_color: "#104B45", type: "static_content" } },
                        { overlay_id: "caption:ho", source: "remote", caption: { background: { colors: ["#E63946", "#F07167", "#FFB4A2"] }, icon: { data: "🤨", type: "emoji" }, max_lines: 1, text: "hỏ?", text_color: "#681D2A", type: "static_content" } },
                        { overlay_id: "caption:lai_phai_lo", source: "remote", caption: { background: { colors: ["#70C1B3", "#B7E4A8", "#F9F7A8"] }, icon: { data: "🫠", type: "emoji" }, max_lines: 1, text: "lại phải lọ", text_color: "#294B42", type: "static_content" } },
                        { overlay_id: "caption:noi_chuyen_met", source: "remote", caption: { background: { colors: ["#6D597A", "#9A789D", "#D5B8D2"] }, icon: { data: "🫠", type: "emoji" }, max_lines: 1, text: "nói chuyện nghe mắc mệt", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:het_noi_noi", source: "remote", caption: { background: { colors: ["#52734D", "#86A873", "#D5E6A8"] }, icon: { data: "🙄", type: "emoji" }, max_lines: 1, text: "đúng là hết nói nổi", text_color: "#263D27", type: "static_content" } },
                        { overlay_id: "caption:chan_bo_may_di", source: "remote", caption: { background: { colors: ["#6A0572", "#AB1745", "#FF7B54"] }, icon: { data: "🙄", type: "emoji" }, max_lines: 1, text: "Chan bố mày đi", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:tuyet_doi_khong_nghe", source: "remote", caption: { background: { colors: ["#FF416C", "#FF4B2B"] }, icon: { data: "🙉", type: "emoji" }, max_lines: 1, text: "Tuyệt đối không nghe", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:khong_thay_khong_nghe", source: "remote", caption: { background: { colors: ["#C4D9CB", "#E5E6D0", "#F3D9C5"] }, icon: { data: "🙈", type: "emoji" }, max_lines: 1, text: "không biết, không thấy, không nghe", text_color: "#425348", type: "static_content" } },
                        { overlay_id: "caption:noi_it_lo", source: "remote", caption: { background: { colors: ["#145A64", "#398A8C", "#B8E0D2"] }, icon: { data: "🤫", type: "emoji" }, max_lines: 1, text: "nói ít thôi, lộ hết bây giờ", text_color: "#12383D", type: "static_content" } },
                        { overlay_id: "caption:nguoi_im_lang_gap_nguoi_hay_noi", source: "remote", caption: { background: { colors: ["#232526", "#414345", "#6C7A89", "#B0BEC5"] }, icon: { data: "🤐", type: "emoji" }, max_lines: 1, text: "Người im lặng gặp người hay nói", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:noi_het_bi_mat_thi_co_yeu_hong", source: "remote", caption: { background: { colors: ["#D8B4E2", "#EAC7D8", "#C4D7F2"] }, icon: { data: "🤫", type: "emoji" }, max_lines: 1, text: "Nói hết bí mật thì có yêu hong", text_color: "#55415F", type: "static_content" } }
                    ]
                },
                {
                    section: "🎨 Deadline & Tiền bạc 💸",
                    items: [
                        { overlay_id: "caption:deadline_ruot", source: "remote", caption: { background: { colors: ["#ED213A", "#93291E"] }, icon: { data: "🔥", type: "emoji" }, max_lines: 1, text: "Deadline dí tụt quần", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:doi_tru_deadline", source: "remote", caption: { background: { colors: ["#F0D1A4", "#F5E2BD", "#D5D9EF"] }, icon: { data: "📚", type: "emoji" }, max_lines: 1, text: "đời cho gì nhận nấy, trừ deadline", text_color: "#5B4A35", type: "static_content" } },
                        { overlay_id: "caption:di_lam_vi_dam_me", source: "remote", caption: { background: { colors: ["#FDC830", "#F37335"] }, icon: { data: "🤡", type: "emoji" }, max_lines: 1, text: "Đi làm vì đam mê", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:ca_o_ran_doc", source: "remote", caption: { background: { colors: ["#0F2027", "#1B5E20", "#66BB6A"] }, icon: { data: "🐍", type: "emoji" }, max_lines: 1, text: "Cả ổ rắn độc", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:nghien_cuu_khoa_hoc", source: "remote", caption: { background: { colors: ["#0F2027", "#2C5364"] }, icon: { data: "☕", type: "emoji" }, max_lines: 1, text: "Cần nạp cafein gấp", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:tien_dau_ma_tieu", source: "remote", caption: { background: { colors: ["#11998E", "#38EF7D"] }, icon: { data: "💸", type: "emoji" }, max_lines: 1, text: "Tiền đâu mà tiêu", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:luc_nao_co_tien_thi_moi_di_a", source: "remote", caption: { background: { colors: ["#0F2027", "#203A43", "#2C5364"] }, icon: { data: "💸", type: "emoji" }, max_lines: 1, text: "Lúc nào có tiền thì mới đi á", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:doc_so_tai_khoan", source: "remote", caption: { background: { colors: ["#1E90FF", "#00D4FF"] }, icon: { data: "💳", type: "emoji" }, max_lines: 1, text: "đọc số tài khoản", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:co_tien_lam_phien_thien_ha", source: "remote", caption: { background: { colors: ["#BFA06A", "#E8D5AD", "#F6EBDD"] }, icon: { data: "💰", type: "emoji" }, max_lines: 1, text: "Có tiền làm phiền thiên hạ", text_color: "#493824", type: "static_content" } },
                        { overlay_id: "caption:co_tien_noi_tiep", source: "remote", caption: { background: { colors: ["#075E54", "#16A085", "#B7E4C7"] }, icon: { data: "💸", type: "emoji" }, max_lines: 1, text: "có tiền thì nói chuyện tiếp", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:doc_lap_tai_chinh", source: "remote", caption: { background: { colors: ["#B8C8B3", "#D9DFC5", "#EAD9B7"] }, icon: { data: "💰", type: "emoji" }, max_lines: 1, text: "độc lập tài chính, độc thân tình cảm", text_color: "#405340", type: "static_content" } },
                        { overlay_id: "caption:cu_tu_tu_khoai_se_nhu", source: "remote", caption: { background: { colors: ["#56AB2F", "#A8E063"] }, icon: { data: "🥔", type: "emoji" }, max_lines: 1, text: "Cứ từ từ khoai sẽ nhừ", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:kiem_tra_nhan_pham", source: "remote", caption: { background: { colors: ["#654EA3", "#EAAFC8"] }, icon: { data: "🎲", type: "emoji" }, max_lines: 1, text: "Kiểm tra nhân phẩm", text_color: "#FFFFFFE6", type: "static_content" } }
                    ]
                },
                {
                    section: "🎨 Daily & Đời sống ☕",
                    items: [
                        { overlay_id: "caption:ngay_moi_vui_ve", source: "remote", caption: { background: { colors: ["#FFB703", "#FFD166", "#FFF0A8"] }, icon: { data: "☀️", type: "emoji" }, max_lines: 1, text: "Ngày mới vui vẻ", text_color: "#69420A", type: "static_content" } },
                        { overlay_id: "caption:coffee_time", source: "remote", caption: { background: { colors: ["#4E342E", "#8D6E63"] }, icon: { data: "☕", type: "emoji" }, max_lines: 1, text: "Coffee Time!", localized_text: { en: "Coffee Time!", vn: "Giờ uống cà phê!" }, text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:matcha_latte", source: "remote", caption: { background: { colors: ["#C8E6C9", "#A5D6A7", "#81C784"] }, icon: { data: "🍃", type: "emoji" }, max_lines: 1, text: "Matcha Latte 🍵", text_color: "#1B5E20E6", type: "static_content" } },
                        { overlay_id: "caption:mixue_time", source: "remote", caption: { background: { colors: ["#FFF9C4", "#F8BBD0"] }, icon: { data: "🍦", type: "emoji" }, max_lines: 1, text: "Mixue Time!", localized_text: { en: "Mixue Time!", vn: "Giờ Mixue!" }, text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:tien_mua_tra_sua", source: "remote", caption: { background: { colors: ["#D7B77D", "#EAD6AA", "#F5E7CC"] }, icon: { data: "🧋", type: "emoji" }, max_lines: 1, text: "tiền không mua được tất cả, nhưng mua được trà sữa", text_color: "#5D472B", type: "static_content" } },
                        { overlay_id: "caption:an_com_chua", source: "remote", caption: { background: { colors: ["#FF9800", "#F57C00"] }, icon: { data: "🍽️", type: "emoji" }, max_lines: 1, text: "Ăn cơm chưa?", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:dinner_time", source: "remote", caption: { background: { colors: ["#FFCCBC", "#FF8A80"] }, icon: { data: "🍽️", type: "emoji" }, max_lines: 1, text: "Dinner Time!", localized_text: { en: "Dinner Time!", vn: "Giờ ăn tối!" }, text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:di_choi_khong", source: "remote", caption: { background: { colors: ["#E91E63", "#C2185B"] }, icon: { data: "✈️", type: "emoji" }, max_lines: 1, text: "Đi chơi không?", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:tuyet_voi_uong_nao", source: "remote", caption: { background: { colors: ["#F0C58E", "#F5D9A9", "#EBC6B8"] }, icon: { data: "🥂", type: "emoji" }, max_lines: 1, text: "tuyệt vời, uống nào!", text_color: "#65462D", type: "static_content" } },
                        { overlay_id: "caption:shopping_time", source: "remote", caption: { background: { colors: ["#B3E5FC", "#FFFFFF"] }, icon: { data: "🛍️", type: "emoji" }, max_lines: 1, text: "Shopping Time!", localized_text: { en: "Shopping Time!", vn: "Giờ mua sắm!" }, text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:cinema_time", source: "remote", caption: { background: { colors: ["#1A237E", "#455A64"] }, icon: { data: "🎬", type: "emoji" }, max_lines: 1, text: "Cinema Time!", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:tuyet_doi_dien_anh", source: "remote", caption: { background: { colors: ["#455A64", "#263238"] }, icon: { data: "📷", type: "emoji" }, max_lines: 1, text: "Tuyệt đối điện ảnh", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:qua_la_dien_anh", source: "remote", caption: { background: { colors: ["#26A69A", "#00897B"] }, icon: { data: "📷", type: "emoji" }, max_lines: 1, text: "Quá là điện ảnh", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:locket_time", source: "remote", caption: { background: { colors: ["#ECEFF1", "#B3E5FC"] }, icon: { data: "📷", type: "emoji" }, max_lines: 1, text: "Locket Time!", text_color: "#000000E6", type: "static_content" } },
                        { overlay_id: "caption:chilling_time", source: "remote", caption: { background: { colors: ["#E1BEE7", "#F8BBD0"] }, icon: { data: "🌴", type: "emoji" }, max_lines: 1, text: "Chilling Time!", localized_text: { en: "Chilling Time!", vn: "Giờ thư giãn!" }, text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:graduation_day", source: "remote", caption: { background: { colors: ["#1A237E", "#283593"] }, icon: { data: "🎓", type: "emoji" }, max_lines: 1, text: "Happy Graduation Day!", localized_text: { en: "Happy Graduation Day!", vn: "Chúc mừng tốt nghiệp!" }, text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:bien_oiiii", source: "remote", caption: { background: { colors: ["#56CFE1", "#72EFDD", "#B8F3FF"] }, icon: { data: "🌊", type: "emoji" }, max_lines: 1, text: "Biển ơiiii", text_color: "#124559", type: "static_content" } },
                        { overlay_id: "caption:hoi_chieu_troi_mua", source: "remote", caption: { background: { image: { type: "image", data: "cloud_cover", source: "local" }, colors: ["#546E7A", "#263238"] }, icon: { data: "🌧️", type: "emoji" }, max_lines: 1, text: "Hồi chiều trời mưa...", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:rainy_day", source: "remote", caption: { background: { image: { type: "image", data: "cloud_cover", source: "local" }, colors: ["#6D4C41", "#8D6E63", "#BCAAA4"] }, icon: { data: "☕", type: "emoji" }, max_lines: 1, text: "Rainy Day ☕🌧️", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:cam_lanh", source: "remote", caption: { background: { colors: ["#2193B0", "#6DD5ED"] }, icon: { data: "🤧", type: "emoji" }, max_lines: 1, text: "Cảm lạnh", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:bau_troi_da_ly_huong", source: "remote", caption: { background: { colors: ["#B8A1D9", "#D8C6E8", "#A9B8E8"] }, icon: { type: "sf_symbol", data: "cloud.moon.fill", color: "#FFFFFF" }, max_lines: 1, text: "nhìn bầu trời màu dạ lý hương", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:night_vibes", source: "remote", caption: { background: { colors: ["#B993D6", "#8CA6DB", "#C9B1FF"] }, icon: { data: "🪐", type: "emoji" }, max_lines: 1, text: "Night Vibes 🌌", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:2am_thoughts", source: "remote", daily_start_hour: 1, daily_end_hour: 3, caption: { background: { colors: ["#0F2027", "#203A43", "#2C5364"] }, icon: { type: "sf_symbol", data: "cloud.bolt.fill", color: "#FFFFFFE6" }, max_lines: 1, text: "2:00 AM Thoughts 🌙", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:ngu_ngon", source: "remote", caption: { background: { colors: ["#3F51B5", "#1A237E"] }, icon: { type: "sf_symbol", data: "moon.zzz.fill", color: "#FFFFFFE6" }, max_lines: 1, text: "Ngủ ngon", text_color: "#FFFFFFE6", type: "static_content" } },
                        { overlay_id: "caption:sweet_dream", source: "remote", caption: { background: { colors: ["#A1C4FD", "#C2E9FB", "#E0F7FA"] }, icon: { data: "☁️", type: "emoji" }, max_lines: 1, text: "Sweet Dream 🧊", text_color: "#1A237EE6", type: "static_content" } },
                        { overlay_id: "caption:nhiem_vu_di_ngu", source: "remote", caption: { background: { colors: ["#172554", "#334EAC", "#91A7FF"] }, icon: { data: "🫡", type: "emoji" }, max_lines: 1, text: "nhiệm vụ hệ thống: đi ngủ", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:da_den_luc_tat_nguon", source: "remote", caption: { background: { colors: ["#283593", "#5C6BC0", "#B3C5FF"] }, icon: { data: "😴", type: "emoji" }, max_lines: 1, text: "đã đến lúc tắt nguồn", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:nao_nghi_lam_tay_van_online", source: "remote", caption: { background: { colors: ["#FF6B35", "#FF9F1C", "#FFE0A3"] }, icon: { data: "🤡", type: "emoji" }, max_lines: 1, text: "não nghỉ làm, tay vẫn online", text_color: "#672812", type: "static_content" } },
                        { overlay_id: "caption:buon_ngu_chua_chiu_ngu", source: "remote", caption: { background: { colors: ["#7B2CBF", "#B185DB", "#E0C3FC"] }, icon: { data: "🫠", type: "emoji" }, max_lines: 1, text: "buồn ngủ nhưng chưa chịu ngủ", text_color: "#39204F", type: "static_content" } },
                        { overlay_id: "caption:pin_nguoi_dung_con_1", source: "remote", caption: { background: { colors: ["#D62828", "#F77F00", "#FCBF49"] }, icon: { data: "🚨", type: "emoji" }, max_lines: 1, text: "cảnh báo: pin người dùng còn 1%", text_color: "#651515", type: "static_content" } },
                        { overlay_id: "caption:nhiem_vu_hom_nay_nam_im", source: "remote", caption: { background: { colors: ["#168AAD", "#52B69A", "#D9ED92"] }, icon: { data: "🛌", type: "emoji" }, max_lines: 1, text: "nhiệm vụ hôm nay: nằm im", text_color: "#17483F", type: "static_content" } },
                        { overlay_id: "caption:mai_tinh_nay_ngu", source: "remote", caption: { background: { colors: ["#343A40", "#6C757D", "#ADB5BD"] }, icon: { data: "💀", type: "emoji" }, max_lines: 1, text: "mai tính, nay ngủ", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:offline_de_hoi_sinh", source: "remote", caption: { background: { colors: ["#006D77", "#83C5BE", "#EDF6F9"] }, icon: { data: "💤", type: "emoji" }, max_lines: 1, text: "offline để hồi sinh", text_color: "#164E52", type: "static_content" } },
                    ]
                },
                {
                    section: "🎨 Chứng nhận của Locket",
                    items: [
                        { overlay_id: "caption:locket_cuti", source: "remote", caption: { background: { colors: ["#35B5E8", "#19A1D8"] }, icon: { data: "checkmark.seal.fill", type: "sf_symbol" }, max_lines: 1, text: "Locket xác nhận bạn cutii", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:locket_xinh", source: "remote", caption: { background: { colors: ["#FFD45C", "#F5B91E"] }, icon: { data: "checkmark.seal.fill", type: "sf_symbol" }, max_lines: 1, text: "Locket xác nhận bạn xjnh gái", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:locket_dep", source: "remote", caption: { background: { colors: ["#258DEB", "#1672D4"] }, icon: { data: "checkmark.seal.fill", type: "sf_symbol" }, max_lines: 1, text: "Locket xác nhận bạn đẹp chai", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:locket_dangiu", source: "remote", caption: { background: { colors: ["#FF638B", "#F44772"] }, icon: { data: "checkmark.seal.fill", type: "sf_symbol" }, max_lines: 1, text: "Locket xác nhận bạn dangiu", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:gai_dep", source: "remote", caption: { background: { colors: ["#FF91AE", "#F8759B"] }, icon: { data: "checkmark.seal.fill", type: "sf_symbol" }, max_lines: 1, text: "Đã xác minh bạn là gái đẹp", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:trai_dep", source: "remote", caption: { background: { colors: ["#4A9FEF", "#267DD7"] }, icon: { data: "checkmark.seal.fill", type: "sf_symbol" }, max_lines: 1, text: "Đã xác minh bạn là trai đẹp", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:be_ngoan", source: "remote", caption: { background: { colors: ["#E9B9C5", "#D9A4B3"] }, icon: { data: "checkmark.seal.fill", type: "sf_symbol" }, max_lines: 1, text: "Đã xác nhận bạn là bé ngoan", text_color: "#FFFFFF", type: "static_content" } },
                        { overlay_id: "caption:tuyen_duong", source: "remote", caption: { background: { colors: ["#D94A77", "#B82D59"] }, icon: { data: "checkmark.seal.fill", type: "sf_symbol" }, max_lines: 1, text: "Locket tuyên dương bạn cute", text_color: "#FFFFFF", type: "static_content" } },
                    ]
                },
            ])
        });

        applyOverrides({
            birthday_feature_config: "{\"profile_menu\":true,\"prompt_interval\":1209600,\"show_frame\":true}",
            calendar_friend_birthdays: "{\"fetching\":true,\"calendar_display\":true,\"feature_popup\":true,\"settings_visibility_toggle_enabled\":true,\"fetch_ttl_seconds\":86400}",
            time_travel_rewind_v2_enabled: "true",
            time_travel_rewind_v2_share_templates: "{\"templates\":[\"rounded_square\",\"grid_collage\",\"cutout_collage\",\"rounded_square_bold\",\"wall_calendar\"],\"random_order\":false}",
            widget_rewind_event: "{\"uid\":\"rewind_monthly_september_2026\",\"override_monthly_schedule\":\"2026-09\",\"start_at\":\"2026-09-30T08:00:00\",\"end_at\":\"2026-10-01T12:00:00\",\"prefetch_moments\":false,\"playback_config\":{\"title\":\"September Rewind\",\"sticker_text\":\"Locket Rewind\",\"absolute_start_date\":\"2026-09-01T00:00:00Z\",\"absolute_end_date\":\"2026-09-29T23:00:00Z\",\"prompt_save\":true,\"prompt_share_options\":false,\"outro\":false,\"countdown\":true,\"campaign\":\"rewind_monthly_september_2026\"},\"widget_config\":{\"title\":\"September Rewind\"}}",
            rollcall_profile_memories_enabled: "true",
            rollcall_profile_memories_config: "{\"share_previews\":true,\"reactions\":true,\"current_week_placeholder\":true}",
            memory_notification_display_config: "{\"calendar_presentation_mode\":\"full\",\"badge_expiration_seconds\":172800,\"pending_memory_badge\":true}",
            rollcall_enabled: "true",
            rollcall_profile_button: "true",
            locket_yearbook_story_sharing_encouraged: "true",
            calendar_rewind_enabled: "true",
            rollcall_profile_memories_enabled: "true",
            rollcall_memories_streaks_enabled: "true"
        });

        applyOverrides({
            streak_reminders: "true",
            catch_up_show_nav_bar: "true",
            pad_server_friend_suggestions: "true",
            widget_last_sent_indicator: "true",
            widget_stale_state_enabled: "true",
            share_history_prompt_enabled: "true",
            show_no_friends_bottom_sheet: "true",
            share_history_config: JSON.stringify({ prompt_enabled: true, fetching_enabled: true })
        });
        var details = ["groups=" + activeGroups.join(",")];
        if (LOCKET_OPTIONS.camera === true) details.push("camera=15s, gallery-video=false");
        if (LOCKET_OPTIONS.audio === true) details.push("sound=true");
        if (LOCKET_OPTIONS.captions === true) {
            var captionSections = JSON.parse(obj.entries.overlay_items);
            var captionCount = captionSections.reduce(function (count, section) { return count + section.items.length; }, 0);
            details.push("captions=" + captionCount);
            var personalCount = captionSections.reduce(function (count, section) {
                return count + section.items.filter(function (item) {
                    return item.overlay_id.indexOf("caption:thuong_men_") === 0;
                }).length;
            }, 0);
            details.push("personal-captions=" + personalCount);
        }
        // The SDK uses response ETags during activation. Identify the rewritten
        // representation rather than reusing an ETag for the upstream body.
        // This small deterministic hash is a cache validator, not a security hash.
        var rewrittenBody = JSON.stringify(obj);
        var hash = 2166136261;
        for (var i = 0; i < rewrittenBody.length; i++) {
            hash ^= rewrittenBody.charCodeAt(i);
            hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
        }
        var responseHeaders = Object.assign({}, $response.headers || {});
        Object.keys(responseHeaders).forEach(function (key) {
            if (key.toLowerCase() === "etag") delete responseHeaders[key];
        });
        responseHeaders.etag = '"locket-v12-' + hash.toString(16) + '"';
        details.push("config-tag=" + hash.toString(16));
        logStatus("response rewritten: " + details.join("; ") + "; device behavior unverified");
        return { body: rewrittenBody, headers: responseHeaders };
    }

    $done(rewriteLocketConfig());

})();
